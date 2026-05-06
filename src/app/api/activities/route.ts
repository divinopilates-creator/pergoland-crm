import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, contacts, deals } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { calculateLeadScore, suggestTemperature } from "@/lib/scoring";
import { classifyLead, isAIEnabled } from "@/lib/claude";
import { pipelineStages } from "@/db/schema";
import { asc } from "drizzle-orm";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

const STAGE_RULES: Record<string, { stageName: string; temperature: "cold" | "warm" | "hot" }> = {
  cotizacion: { stageName: "Cotización Enviada", temperature: "warm" },
  visita:     { stageName: "Visita Programada",  temperature: "hot"  },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get("contactId");
  const dealId = searchParams.get("dealId");

  let query = db
    .select({
      id: activities.id,
      type: activities.type,
      description: activities.description,
      contactId: activities.contactId,
      dealId: activities.dealId,
      scheduledAt: activities.scheduledAt,
      completedAt: activities.completedAt,
      attachmentPath: activities.attachmentPath,
      createdAt: activities.createdAt,
      contactName: contacts.name,
    })
    .from(activities)
    .leftJoin(contacts, eq(activities.contactId, contacts.id));

  if (contactId) {
    query = query.where(eq(activities.contactId, contactId)) as typeof query;
  }

  if (dealId) {
    query = query.where(eq(activities.dealId, dealId)) as typeof query;
  }

  const results = query.orderBy(desc(activities.createdAt)).all();
  return NextResponse.json(results);
}

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }
  const { type, description, contactId, dealId, scheduledAt, attachmentPath, dealValue } = body;

  if (!type || !description || !contactId) {
    return NextResponse.json(
      { error: "Tipo, descripcion y contacto son requeridos" },
      { status: 400 }
    );
  }

  try {
    const result = db
      .insert(activities)
      .values({
        type,
        description,
        contactId,
        dealId: dealId || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        completedAt: null,
        createdAt: new Date(),
        attachmentPath: attachmentPath || null,
      })
      .returning()
      .get();

    // Actualizar valor del deal si se proporcionó
    if (dealValue && typeof dealValue === "number" && dealValue > 0) {
      const dealToUpdate = dealId
        ? db.select().from(deals).where(eq(deals.id, dealId)).get()
        : db.select().from(deals).where(eq(deals.contactId, contactId)).get();
      if (dealToUpdate) {
        db.update(deals).set({ value: dealValue, updatedAt: new Date() }).where(eq(deals.id, dealToUpdate.id)).run();
      }
    }

    // Automatismo: mover etapa + temperatura según tipo de actividad
    await aplicarReglasPipeline(type, contactId, dealId || null);

    // Envío automático de email si es cotización con PDF adjunto
    if (type === "cotizacion" && attachmentPath) {
      await enviarEmailCotizacion(contactId, result.id, attachmentPath).catch(() => {});
    }

    // Envío automático de email si es visita programada con fecha
    if (type === "visita" && scheduledAt) {
      await enviarEmailVisita(contactId, scheduledAt).catch(() => {});
    }
    await recalcularTemperatura(contactId);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown";
    return NextResponse.json(
      { error: `Error al crear actividad: ${msg}` },
      { status: 500 }
    );
  }
}

async function aplicarReglasPipeline(type: string, contactId: string, dealId: string | null) {
  const rule = STAGE_RULES[type];
  if (!rule) return;

  // Forzar temperatura directamente
  db.update(contacts)
    .set({ temperature: rule.temperature, updatedAt: new Date() })
    .where(eq(contacts.id, contactId))
    .run();

  // Buscar la etapa destino
  const stages = db.select().from(pipelineStages).orderBy(asc(pipelineStages.order)).all();
  const targetStage = stages.find((s) => s.name === rule.stageName);
  if (!targetStage) return;

  // Mover el deal asociado (o el primer deal del contacto)
  const dealToMove = dealId
    ? db.select().from(deals).where(eq(deals.id, dealId)).get()
    : db.select().from(deals).where(eq(deals.contactId, contactId)).get();

  if (dealToMove) {
    db.update(deals)
      .set({ stageId: targetStage.id, updatedAt: new Date() })
      .where(eq(deals.id, dealToMove.id))
      .run();
  }
}

async function recalcularTemperatura(contactId: string) {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return;

  const contactActivities = db.select().from(activities).where(eq(activities.contactId, contactId)).all();
  const contactDeals = db.select().from(deals).where(eq(deals.contactId, contactId)).all();

  if (isAIEnabled()) {
    try {
      const result = await classifyLead(
        { name: contact.name, company: contact.company || undefined, source: contact.source, notes: contact.notes || undefined },
        contactActivities.map((a) => ({
          type: a.type as "call" | "email" | "meeting" | "note" | "follow_up",
          description: a.description,
          date: a.createdAt ? new Date(typeof a.createdAt === "number" ? a.createdAt * 1000 : a.createdAt).toISOString() : "unknown",
        }))
      );
      db.update(contacts).set({ temperature: result.temperature, score: result.score, updatedAt: new Date() }).where(eq(contacts.id, contactId)).run();
      return;
    } catch {
      // fall through to rule-based
    }
  }

  const lastActivity = [...contactActivities].sort((a, b) => {
    const aTime = typeof a.createdAt === "number" ? a.createdAt : a.createdAt?.getTime() || 0;
    const bTime = typeof b.createdAt === "number" ? b.createdAt : b.createdAt?.getTime() || 0;
    return bTime - aTime;
  })[0];

  const daysSinceLastActivity = lastActivity
    ? Math.floor((Date.now() - (typeof lastActivity.createdAt === "number" ? lastActivity.createdAt * 1000 : lastActivity.createdAt?.getTime() || Date.now())) / (1000 * 60 * 60 * 24))
    : 999;

  const totalDealValue = contactDeals.reduce((sum, d) => sum + (d.value || 0), 0);

  const score = calculateLeadScore({
    temperature: contact.temperature as "cold" | "warm" | "hot",
    hasEmail: !!contact.email,
    hasPhone: !!contact.phone,
    hasCompany: !!contact.company,
    activityCount: contactActivities.length,
    daysSinceLastActivity,
    hasDeals: contactDeals.length > 0,
    dealValue: totalDealValue,
  });

  const temperature = suggestTemperature(score);
  db.update(contacts).set({ temperature, score, updatedAt: new Date() }).where(eq(contacts.id, contactId)).run();
}

async function enviarEmailVisita(contactId: string, scheduledAt: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;

  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact?.email) return;

  const fecha = new Date(scheduledAt);
  const opciones: Intl.DateTimeFormatOptions = {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago",
  };
  const fechaFormateada = fecha.toLocaleDateString("es-CL", opciones);

  const transporter = nodemailer.createTransport({
    host: "smtppro.zoho.com",
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `"Pergoland Chile" <${process.env.GMAIL_USER}>`,
    to: contact.email,
    subject: `Visita confirmada - Pergoland Chile`,
    html: `
      <p>Estimado/a <strong>${contact.name}</strong>,</p>
      <p>Confirmamos la visita de medición para su proyecto de pérgola:</p>
      <p style="font-size:16px; font-weight:bold; margin: 16px 0;">📅 ${fechaFormateada}</p>
      <p>Para confirmar asistencia o informar cualquier cambio, contáctenos al:</p>
      <p style="font-size:16px; font-weight:bold;">📞 +56997081762</p>
      <br>
      <p>¡Nos vemos pronto!<br><strong>Equipo Pergoland Chile</strong></p>
    `,
  });
}

async function enviarEmailCotizacion(contactId: string, activityId: string, attachmentPath: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;

  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact?.email) return;

  const fullPath = path.join(process.cwd(), "data", attachmentPath);
  if (!fs.existsSync(fullPath)) return;

  const transporter = nodemailer.createTransport({
    host: "smtppro.zoho.com",
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `"Pergoland Chile" <${process.env.GMAIL_USER}>`,
    to: contact.email,
    subject: `Cotización Pergoland - ${contact.name}`,
    html: `
      <p>Estimado/a <strong>${contact.name}</strong>,</p>
      <p>Adjuntamos la cotización solicitada para su proyecto de pérgola.</p>
      <p>Quedamos a su disposición para cualquier consulta.</p>
      <br>
      <p>Saludos,<br><strong>Equipo Pergoland Chile</strong></p>
    `,
    attachments: [{
      filename: path.basename(fullPath),
      content: fs.readFileSync(fullPath),
      contentType: "application/pdf",
    }],
  });
}
