#!/usr/bin/env npx tsx
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pipelineStages } from "../src/db/schema";
import crypto from "crypto";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL no está definida");
}

const client = postgres(connectionString);
const db = drizzle(client);

async function main() {
  console.log("Inicializando Pergoland CRM...");

  const existing = await db.select().from(pipelineStages);

  if (existing.length === 0) {
    const defaultStages = [
      { name: "Nuevo Lead",                order: 1, color: "#64748b", isWon: false, isLost: false },
      { name: "Pendiente de Calificacion", order: 2, color: "#2563eb", isWon: false, isLost: false },
      { name: "Cotizacion Enviada",        order: 3, color: "#8b5cf6", isWon: false, isLost: false },
      { name: "Visita Programada",         order: 4, color: "#ea580c", isWon: false, isLost: false },
      { name: "Negociacion",               order: 5, color: "#f59e0b", isWon: false, isLost: false },
      { name: "Ganado",                    order: 6, color: "#16a34a", isWon: true,  isLost: false },
      { name: "Perdido",                   order: 7, color: "#dc2626", isWon: false, isLost: true  },
    ];

    for (const stage of defaultStages) {
      await db.insert(pipelineStages).values({
        id:     crypto.randomUUID(),
        name:   stage.name,
        order:  stage.order,
        color:  stage.color,
        isWon:  stage.isWon,
        isLost: stage.isLost,
      });
    }
    console.log("✅ 7 etapas Pergoland creadas.");
  } else {
    console.log(`✅ Ya existen ${existing.length} etapas — sin cambios.`);
  }

  await client.end();
  console.log("✅ Pergoland CRM inicializado correctamente.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});