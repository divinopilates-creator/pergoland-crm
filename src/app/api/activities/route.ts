import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activities, contacts, deals, pipelineStages } from "@/db/schema";
import { eq, desc, asc, isNull } from "drizzle-orm";
import { calculateLeadScore, suggestTemperature } from "@/lib/scoring";
import { classifyLead, isAIEnabled } from "@/lib/claude";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

const STAGE_RULES: Record<string, { stageName: string; temperature: "cold" | "warm" | "hot" }> = {
  cotizacion: { stageName: "Cotizacion Enviada", temperature: "warm" },
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

  const results = await query.orderBy(desc(activities.createdAt));
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
    return NextResponse.json({ error: "Tipo, descripcion y contacto son requeridos" }, { status: 400 });
  }

  try {
    const rows = await db.insert(activities).values({
      type,
      description,
      contactId,
      dealId: dealId || null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      completedAt: null,
      createdAt: new Date(),
      attachmentPath: attachmentPath || null,
    }).returning();
    const result = rows[0];

    if (dealValue && typeof dealValue === "number" && dealValue > 0) {
      const dealRows = dealId
        ? await db.select().from(deals).where(eq(deals.id, dealId))
        : await db.select().from(deals).where(eq(deals.contactId, contactId));
      const dealToUpdate = dealRows[0];
      if (dealToUpdate) {
        await db.update(deals).set({ value: dealValue, updatedAt: new Date() }).where(eq(deals.id, dealToUpdate.id));
      }
    }

    await aplicarReglasPipeline(type, contactId, dealId || null);

    if (type === "cotizacion" && attachmentPath) {
      await enviarEmailCotizacion(contactId, result.id, attachmentPath).catch(() => {});
    }
    if (type === "visita" && scheduledAt) {
      await enviarEmailVisita(contactId, scheduledAt).catch(() => {});
    }

    await recalcularTemperatura(contactId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown";
    return NextResponse.json({ error: `Error al crear actividad: ${msg}` }, { status: 500 });
  }
}

async function aplicarReglasPipeline(type: string, contactId: string, dealId: string | null) {
  const rule = STAGE_RULES[type];
  if (!rule) return;

  await db.update(contacts).set({ temperature: rule.temperature, updatedAt: new Date() }).where(eq(contacts.id, contactId));

  const stages = await db.select().from(pipelineStages).orderBy(asc(pipelineStages.order));
  const targetStage = stages.find((s) => s.name === rule.stageName);
  if (!targetStage) return;

  const dealRows = dealId
    ? await db.select().from(deals).where(eq(deals.id, dealId))
    : await db.select().from(deals).where(eq(deals.contactId, contactId));
  const dealToMove = dealRows[0];

  if (dealToMove) {
    await db.update(deals).set({ stageId: targetStage.id, updatedAt: new Date() }).where(eq(deals.id, dealToMove.id));
  }

  // Trigger al agente para activar timer de recordatorio
  const agentkitUrl = process.env.AGENTKIT_URL;
  if (agentkitUrl && (type === "cotizacion" || type === "visita")) {
    try {
      const contactRows = await db.select().from(contacts).where(eq(contacts.id, contactId));
      const contact = contactRows[0];
      if (contact?.phone) {
        const telefono = contact.phone.replace(/\D/g, "");
        await fetch(`${agentkitUrl}/handoff/activar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telefono, tipo: type }),
        });
        console.log(`Timer ${type} activado para ${telefono}`);
      }
    } catch (err) {
      console.error("Error activando timer en agente:", err);
    }
  }
}

async function recalcularTemperatura(contactId: string) {
  const contactRows = await db.select().from(contacts).where(eq(contacts.id, contactId));
  const contact = contactRows[0];
  if (!contact) return;

  const contactActivities = await db.select().from(activities).where(eq(activities.contactId, contactId));
  const contactDeals = await db.select().from(deals).where(eq(deals.contactId, contactId));

  if (isAIEnabled()) {
    try {
      const result = await classifyLead(
        { name: contact.name, company: contact.company || undefined, source: contact.source, notes: contact.notes || undefined },
        contactActivities.map((a) => ({
          type: a.type as "call" | "email" | "meeting" | "note" | "follow_up",
          description: a.description,
          date: a.createdAt ? new Date(a.createdAt).toISOString() : "unknown",
        }))
      );
      await db.update(contacts).set({ temperature: result.temperature, score: result.score, updatedAt: new Date() }).where(eq(contacts.id, contactId));
      return;
    } catch { /* fall through */ }
  }

  const lastActivity = [...contactActivities].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];

  const daysSinceLastActivity = lastActivity
    ? Math.floor((Date.now() - new Date(lastActivity.createdAt).getTime()) / (1000 * 60 * 60 * 24))
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
  await db.update(contacts).set({ temperature, score, updatedAt: new Date() }).where(eq(contacts.id, contactId));
}

async function enviarEmailVisita(contactId: string, scheduledAt: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;
  const rows = await db.select().from(contacts).where(eq(contacts.id, contactId));
  const contact = rows[0];
  if (!contact?.email) return;

  const fecha = new Date(scheduledAt);
  const fechaFormateada = fecha.toLocaleDateString("es-CL", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago",
  });

  const transporter = nodemailer.createTransport({
    host: "smtppro.zoho.com", port: 465, secure: true,
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
  const rows = await db.select().from(contacts).where(eq(contacts.id, contactId));
  const contact = rows[0];
  if (!contact?.email) return;

  const fullPath = path.join(process.cwd(), "data", attachmentPath);
  if (!fs.existsSync(fullPath)) return;

  const transporter = nodemailer.createTransport({
    host: "smtppro.zoho.com", port: 465, secure: true,
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
