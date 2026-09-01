/**
 * 种子数据导入：把 data/words/*.json 一次性写入 SQLite。
 * 用法：npm run seed（幂等，INSERT OR REPLACE）
 */
import fs from "fs";
import path from "path";
import { getDb, upsertWord, countWords, WordEntry } from "./db";
import { idOf } from "./validate";

const WORDS_DIR = path.resolve(__dirname, "..", "data", "words");

function main() {
  getDb(); // 确保建表
  if (!fs.existsSync(WORDS_DIR)) {
    console.error(`✗ 种子目录不存在: ${WORDS_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(WORDS_DIR).filter((f) => f.endsWith(".json"));
  let n = 0;
  for (const f of files) {
    const w = JSON.parse(fs.readFileSync(path.join(WORDS_DIR, f), "utf8"));
    const entry: WordEntry = {
      id: w.id || idOf(w.word),
      word: String(w.word).trim(),
      phonetic: w.phonetic || "",
      pos: w.pos || "",
      family: w.family || w.id || idOf(w.word),
      morph: w.morph || "",
      tags: w.tags || [],
      meaning: w.meaning || "",
      examples: w.examples || [],
      derivatives: w.derivatives || []
    };
    upsertWord(entry);
    n++;
    console.log(`  + ${entry.word}`);
  }
  console.log(`✓ seeded ${n} files, db total: ${countWords()} words`);
}

main();
