import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contacts, activities, crmSettings, deals, pipelineStages } from "@/db/schema";
import { eq } from "drizzle-orm";

// Field name mapping: common variations → standard field
const FIELD_MAP: Record<string, string> = {
  // Name
  name: "name",
  nombre: "name",
  full_name: "name",
  fullname: "name",
  first_name: "name",
  nombre_completo: "name",
  // Email
  email: "email",
  correo: "email",
  email_address: "email",
  correo_electronico: "email",
  // Phone
  phone: "phone",
  telefono: "phone",
  phone_number: "phone",
  cel: "phone",
  celular: "phone",
  whatsapp: "phone",
  movil: "phone",
  // Company
  company: "company",
  empresa: "company",
  company_name: "company",
  negocio: "company",
  organizacion: "company",
  // Notes
  notes: "notes",
  notas: "notes",
  message: "notes",
  mensaje: "notes",
  comments: "notes",
  comentarios: "notes",
  descripcion: "notes",
};

function extractFields(
  payload: Record<string, unknown>
): Record<string, string> {
  // Handle Typeform-style nested data
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, "_");
    const mappedField = FIELD_MAP[normalizedKey];
    if (mappedField && !result[mappedField]) {
      result[mappedField] = String(value).trim();
    }
  }

  // Handle "first_name + last_name" pattern
  if (!result.name) {
    const firstName =
      data.first_name || data.nombre || data.firstName || data.primer_nombre;
    const lastName =
      data.last_name || data.apellido || data.lastName || data.apellidos;
    if (firstName) {
      result.name = [firstName, lastName].filter(Boolean).join(" ").trim();
    }
  }

  return result;
}

export async function POST(request: NextRequest) {
  // Auth check: if a webhook secret is stored, require it in the header
  const stored = db
    .select()
    .from(crmSettings)
    .where(eq(crmSettings.key, "webhook_secret"))
    .get();

  if (stored) {
    const secretHeader = request.headers.get("x-webhook-secret");
    if (!secretHeader || secretHeader !== stored.value) {
      return NextResponse.json(
        { error: "Secret invalido o faltante" },
        { status: 401 }
      );
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const fields = extractFields(payload);
  const isDistribuidor = payload.type === "distribuidor";
  const sourceOverride = typeof payload.source === "string" ? payload.source : undefined;

// Evitar duplicados por telefono
  if (fields.phone) {
    const existing = db
      .select()
      .from(contacts)
      .where(eq(contacts.phone, fields.phone))
      .get();
    if (existing) {
      return NextResponse.json(
        { success: true, message: "Contacto ya existe" },
        { status: 200 }
      );
    }
  }

  if (!fields.name) {
    return NextResponse.json(
      {
        error: "Campo 'name' o 'nombre' es requerido",
        received: Object.keys(payload),
        hint: "Campos soportados: name, nombre, full_name, email, correo, phone, telefono, company, empresa, notes, notas, message",
      },
      { status: 400 }
    );
  }

  try {
    const now = new Date();
    const contact = db
      .insert(contacts)
      .values({
        name: fields.name,
        email: fields.email || null,
        phone: fields.phone || null,
        company: fields.company || null,
        source: sourceOverride || "webhook",
        temperature: "cold",
        score: 0,
        notes: fields.notes || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    if (!isDistribuidor) {
      // Crear deal en primera etapa del pipeline
      const firstStage = db
        .select()
        .from(pipelineStages)
        .orderBy(pipelineStages.order)
        .limit(1)
        .get();

      if (firstStage) {
        db.insert(deals)
          .values({
            title: `Pérgola - ${fields.name}`,
            value: 0,
            stageId: firstStage.id,
            contactId: contact.id,
            notes: fields.notes || null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }

    // Log activity
    db.insert(activities)
      .values({
        type: "note",
        description: isDistribuidor
          ? "Lead madera — derivar a distribuidor autorizado"
          : "Lead recibido via WhatsApp - Matías",
        contactId: contact.id,
        createdAt: now,
      })
      .run();

    return NextResponse.json(
      {
        success: true,
        contact: {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          source: contact.source,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: `Error al crear contacto: ${error instanceof Error ? error.message : "Unknown"}`,
      },
      { status: 500 }
    );
  }
}
