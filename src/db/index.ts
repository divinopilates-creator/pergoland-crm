import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "crm.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function createDatabase(): Database.Database {
  const db = new Database(DB_PATH, { timeout: 15000 });

  // Set pragmas individually with error handling
  try {
    db.pragma("journal_mode = WAL");
  } catch {
    // WAL mode might already be set by another process
  }

  try {
    db.pragma("busy_timeout = 15000");
  } catch {
    // Ignore if can't set
  }

  try {
    db.pragma("foreign_keys = ON");
  } catch {
    // Ignore
  }

  return db;
}

function initTables(db: Database.Database): void {
  // Each CREATE TABLE is its own statement to minimize lock time
  const tables = [
    `CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      source TEXT NOT NULL DEFAULT 'otro',
      temperature TEXT NOT NULL DEFAULT 'cold',
      score INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pipeline_stages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b',
      is_won INTEGER NOT NULL DEFAULT 0,
      is_lost INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      stage_id TEXT NOT NULL REFERENCES pipeline_stages(id),
      contact_id TEXT NOT NULL REFERENCES contacts(id),
      expected_close INTEGER,
      probability INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      contact_id TEXT NOT NULL REFERENCES contacts(id),
      deal_id TEXT REFERENCES deals(id),
      scheduled_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS crm_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ];

  for (const sql of tables) {
    try {
      db.exec(sql);
    } catch {
      // Table might already exist or DB is locked - safe to continue
    }
  }
}

function runMigrations(db: Database.Database): void {
  try {
    // Agregar campos Pergoland si no existen
    const contactCols = db.prepare("PRAGMA table_info(contacts)").all() as Array<{ name: string }>;
    const camposPergoland = [
      { name: "comuna",               sql: "ALTER TABLE contacts ADD COLUMN comuna TEXT" },
      { name: "medidas",              sql: "ALTER TABLE contacts ADD COLUMN medidas TEXT" },
      { name: "modelo",               sql: "ALTER TABLE contacts ADD COLUMN modelo TEXT" },
      { name: "tipo_cielo",           sql: "ALTER TABLE contacts ADD COLUMN tipo_cielo TEXT" },
      { name: "presupuesto_estimado", sql: "ALTER TABLE contacts ADD COLUMN presupuesto_estimado INTEGER" },
      { name: "fecha_visita",         sql: "ALTER TABLE contacts ADD COLUMN fecha_visita INTEGER" },
      { name: "direccion",            sql: "ALTER TABLE contacts ADD COLUMN direccion TEXT" },
    ];
    for (const campo of camposPergoland) {
      if (!contactCols.find((c) => c.name === campo.name)) {
        db.exec(campo.sql);
      }
    }

    // Add attachment_path column if missing
    const cols = db.prepare("PRAGMA table_info(activities)").all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "attachment_path")) {
      db.exec("ALTER TABLE activities ADD COLUMN attachment_path TEXT");
    }
    
    // Add Cotización Enviada and Visita Programada stages if missing
    const stageNames = (db.prepare("SELECT name FROM pipeline_stages").all() as Array<{ name: string }>).map((s) => s.name);
    const maxOrder = (db.prepare("SELECT MAX(\"order\") as mo FROM pipeline_stages").get() as { mo: number | null }).mo || 4;

    const missingStages = [
  { name: "Nuevo Lead", color: "#64748b", order: 1 },
  { name: "Pendiente de Calificacion", color: "#2563eb", order: 2 },
  { name: "Cotizacion Enviada", color: "#8b5cf6", order: 3 },
  { name: "Visita Programada", color: "#ea580c", order: 4 },
  { name: "Negociacion", color: "#f59e0b", order: 5 },
  { name: "Ganado", color: "#16a34a", order: 6 },
  { name: "Perdido", color: "#dc2626", order: 7 },
].filter((s) => !stageNames.includes(s.name));

    const insertStage = db.prepare(`INSERT INTO pipeline_stages (id, name, "order", color, is_won, is_lost) VALUES (?, ?, ?, ?, 0, 0)`);
    for (const s of missingStages) {
      insertStage.run(crypto.randomUUID(), s.name, s.order, s.color);
    }
    // Limpiar etapas duplicadas: mover las nuevas a posición correcta y eliminar las viejas
    try {
      const oldCot = db.prepare("SELECT id FROM pipeline_stages WHERE name = 'Cotizacion Enviada'").get() as { id: string } | undefined;
      const newCot = db.prepare("SELECT id FROM pipeline_stages WHERE name = 'Cotización Enviada'").get() as { id: string } | undefined;
      const oldVis = db.prepare("SELECT id FROM pipeline_stages WHERE name = 'Visita Medicion'").get() as { id: string } | undefined;
      const newVis = db.prepare("SELECT id FROM pipeline_stages WHERE name = 'Visita Programada'").get() as { id: string } | undefined;

      if (oldCot && newCot) {
        db.prepare("UPDATE pipeline_stages SET \"order\" = 3 WHERE id = ?").run(newCot.id);
        db.prepare("DELETE FROM pipeline_stages WHERE id = ?").run(oldCot.id);
      }
      if (oldVis && newVis) {
        db.prepare("UPDATE pipeline_stages SET \"order\" = 4 WHERE id = ?").run(newVis.id);
        db.prepare("DELETE FROM pipeline_stages WHERE id = ?").run(oldVis.id);
      }
    } catch {
      // ignore
    }
  } catch {
    // Migrations can fail on first boot before tables exist — safe to ignore
  }
}

function seedDefaultStages(db: Database.Database): void {
  try {
    const result = db
      .prepare("SELECT COUNT(*) as count FROM pipeline_stages")
      .get() as { count: number } | undefined;

    if (!result || result.count > 0) return;

    const defaultStages = [
  { name: "Nuevo Lead", order: 1, color: "#64748b", isWon: 0, isLost: 0 },
  { name: "Pendiente de Calificacion", order: 2, color: "#2563eb", isWon: 0, isLost: 0 },
  { name: "Cotizacion Enviada", order: 3, color: "#8b5cf6", isWon: 0, isLost: 0 },
  { name: "Visita Programada", order: 4, color: "#ea580c", isWon: 0, isLost: 0 },
  { name: "Negociacion", order: 5, color: "#f59e0b", isWon: 0, isLost: 0 },
  { name: "Ganado", order: 6, color: "#16a34a", isWon: 1, isLost: 0 },
  { name: "Perdido", order: 7, color: "#dc2626", isWon: 0, isLost: 1 },
];

    const insert = db.prepare(
      `INSERT OR IGNORE INTO pipeline_stages (id, name, "order", color, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?)`
    );

    const seedAll = db.transaction(() => {
      for (const stage of defaultStages) {
        insert.run(
          crypto.randomUUID(),
          stage.name,
          stage.order,
          stage.color,
          stage.isWon,
          stage.isLost
        );
      }
    });

    seedAll();
  } catch {
    // Seeding can fail if another worker is doing it — that's fine
  }
}

const sqlite = createDatabase();
initTables(sqlite);
runMigrations(sqlite);
seedDefaultStages(sqlite);

export const db = drizzle(sqlite, { schema });
