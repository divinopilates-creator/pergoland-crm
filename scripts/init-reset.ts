import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const DB_PATH = path.join(process.cwd(), "data", "crm.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("foreign_keys = OFF");

// Borrar en orden correcto
sqlite.exec(`DELETE FROM activities;`);
sqlite.exec(`DELETE FROM deals;`);
sqlite.exec(`DELETE FROM pipeline_stages;`);

// Insertar etapas Pergoland
const stages = [
  { name: "Nuevo Lead", order: 1, color: "#64748b", isWon: 0, isLost: 0 },
  { name: "Pendiente de Calificacion", order: 2, color: "#2563eb", isWon: 0, isLost: 0 },
  { name: "Cotizacion Enviada", order: 3, color: "#8b5cf6", isWon: 0, isLost: 0 },
  { name: "Visita Programada", order: 4, color: "#ea580c", isWon: 0, isLost: 0 },
  { name: "Negociacion", order: 5, color: "#f59e0b", isWon: 0, isLost: 0 },
  { name: "Ganado", order: 6, color: "#16a34a", isWon: 1, isLost: 0 },
  { name: "Perdido", order: 7, color: "#dc2626", isWon: 0, isLost: 1 },
];

const insert = sqlite.prepare(
  `INSERT INTO pipeline_stages (id, name, "order", color, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?)`
);

for (const s of stages) {
  insert.run(crypto.randomUUID(), s.name, s.order, s.color, s.isWon, s.isLost);
}

console.log("Etapas Pergoland creadas OK");
sqlite.pragma("foreign_keys = ON");
sqlite.close();