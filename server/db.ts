import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface Example {
  en: string;
  zh: string;
}

export interface Derivative {
  word: string;
  phonetic?: string;
  meaning: string;
  ref?: string;
}

export interface WordEntry {
  id: string;
  word: string;
  phonetic: string;
  pos: string;
  family: string;
  morph: string;
  tags: string[];
  meaning: string;
  examples: Example[];
  derivatives: Derivative[];
}

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "data", "words.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id          TEXT PRIMARY KEY,
      word        TEXT NOT NULL UNIQUE,
      phonetic    TEXT NOT NULL DEFAULT '',
      pos         TEXT NOT NULL DEFAULT '',
      family      TEXT NOT NULL,
      morph       TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL,
      meaning     TEXT NOT NULL,
      examples    TEXT NOT NULL,
      derivatives TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

interface WordRow {
  id: string;
  word: string;
  phonetic: string;
  pos: string;
  family: string;
  morph: string;
  tags: string;
  meaning: string;
  examples: string;
  derivatives: string;
}

function rowToEntry(row: WordRow): WordEntry {
  return {
    id: row.id,
    word: row.word,
    phonetic: row.phonetic || "",
    pos: row.pos || "",
    family: row.family,
    morph: row.morph || "",
    tags: JSON.parse(row.tags),
    meaning: row.meaning,
    examples: JSON.parse(row.examples),
    derivatives: JSON.parse(row.derivatives || "[]")
  };
}

export function listWords(): WordEntry[] {
  const rows = getDb().prepare("SELECT * FROM words").all() as WordRow[];
  return rows.map(rowToEntry);
}

export function getWord(id: string): WordEntry | undefined {
  const row = getDb().prepare("SELECT * FROM words WHERE id = ?").get(id) as WordRow | undefined;
  return row ? rowToEntry(row) : undefined;
}

export function upsertWord(w: WordEntry): void {
  const stmt = getDb().prepare(`
    INSERT INTO words (id, word, phonetic, pos, family, morph, tags, meaning, examples, derivatives, updated_at)
    VALUES (@id, @word, @phonetic, @pos, @family, @morph, @tags, @meaning, @examples, @derivatives, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      word = excluded.word,
      phonetic = excluded.phonetic,
      pos = excluded.pos,
      family = excluded.family,
      morph = excluded.morph,
      tags = excluded.tags,
      meaning = excluded.meaning,
      examples = excluded.examples,
      derivatives = excluded.derivatives,
      updated_at = datetime('now')
  `);
  stmt.run({
    id: w.id,
    word: w.word,
    phonetic: w.phonetic || "",
    pos: w.pos || "",
    family: w.family,
    morph: w.morph || "",
    tags: JSON.stringify(w.tags),
    meaning: w.meaning,
    examples: JSON.stringify(w.examples),
    derivatives: JSON.stringify(w.derivatives || [])
  });
}

export function countWords(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM words").get() as { c: number };
  return row.c;
}
