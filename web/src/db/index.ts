import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";

// Singleton pattern — avoids multiple connections on Next.js hot reload
const DB_PATH = path.join(process.cwd(), "data", "stock-picker.db");

let db: ReturnType<typeof drizzle>;

function getDb() {
  if (!db) {
    const sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
  }
  return db;
}

export { getDb };
export type Db = ReturnType<typeof getDb>;
