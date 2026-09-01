#!/usr/bin/env node
/**
 * 单词卡片 CLI —— 通过后端 API 查询 / 写入（数据源是 VPS 上的 SQLite）
 *
 * 环境变量：
 *   WORDS_API_URL    服务地址（默认 http://127.0.0.1:3000）
 *   WORDS_API_TOKEN  写入令牌（即服务端 ADMIN_TOKEN，add/update 必需）
 *
 * 用法：
 *   node tools/words.js family <word>          查重 + 查词族（录入前必跑）
 *   node tools/words.js search <keyword>       模糊搜索（单词/释义/标签）
 *   node tools/words.js index                  输出精简索引（省 token 用）
 *   node tools/words.js add --file <path>       新增单词（JSON 文件或 stdin）
 *   node tools/words.js update --file <path>    更新已有单词
 *   node tools/words.js export [--dir <path>]   拉取全量数据快照为 JSON 文件（备份用，默认 data/words）
 */

const fs = require("fs");
const path = require("path");

const API = process.env.WORDS_API_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.WORDS_API_TOKEN || "";
const ROOT = path.resolve(__dirname, "..");

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

async function api(pathname, options = {}) {
  const res = await fetch(API + pathname, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}),
      ...(options.headers || {})
    }
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    if (Array.isArray(data.errors)) data.errors.forEach((e) => console.error("✗ " + e));
    if (data.warns) data.warns.forEach((w) => console.warn("⚠ " + w));
    fail(data.error || `HTTP ${res.status}`);
  }
  if (data.warns) data.warns.forEach((w) => console.warn("⚠ " + w));
  return data;
}

function readInput(file) {
  const raw = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  if (!raw || !raw.trim()) fail("未读取到输入 JSON（用 --file <path> 或 stdin 传入）");
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail("输入 JSON 解析失败: " + e.message);
  }
}

function idOf(word) {
  return String(word || "").trim().toLowerCase().replace(/\s+/g, "-");
}

async function cmdFamily(word) {
  if (!word) fail("用法：node tools/words.js family <word>");
  const data = await api("/api/family?word=" + encodeURIComponent(word));
  console.log(JSON.stringify(data, null, 2));
}

async function cmdSearch(kw) {
  if (!kw) fail("用法：node tools/words.js search <keyword>");
  const data = await api("/api/search?q=" + encodeURIComponent(kw));
  console.log(JSON.stringify(data, null, 2));
}

async function cmdIndex() {
  const data = await api("/api/words");
  const index = data.words
    .slice()
    .sort((a, b) => a.word.localeCompare(b.word))
    .map((w) => {
      const o = { id: w.id, word: w.word, family: w.family || w.id, tags: w.tags };
      if (w.pos) o.pos = w.pos;
      if (w.morph) o.morph = w.morph.split(/\s+/)[0];
      return o;
    });
  console.log(JSON.stringify(index, null, 2));
}

async function cmdUpsert(mode, file) {
  const body = readInput(file);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("输入必须是单个单词 JSON 对象，不能是数组");
  }
  if (!body.word) fail("JSON 缺少 word 字段");

  let data;
  if (mode === "add") {
    data = await api("/api/words", { method: "POST", body: JSON.stringify(body) });
  } else {
    data = await api("/api/words/" + idOf(body.word), {
      method: "PUT",
      body: JSON.stringify(body)
    });
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: data.action,
        id: data.id,
        word: data.word,
        family: data.family,
        morph: data.morph,
        familyMembers: data.familyMembers,
        examples: data.examples,
        tags: data.tags,
        totalWords: data.totalWords,
        totalFamilies: data.totalFamilies
      },
      null,
      2
    )
  );
}

async function cmdExport(dir) {
  const outDir = dir || path.join(ROOT, "data", "words");
  const data = await api("/api/words");
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const w of data.words) {
    const ordered = {
      id: w.id,
      word: w.word,
      ...(w.phonetic ? { phonetic: w.phonetic } : {}),
      ...(w.pos ? { pos: w.pos } : {}),
      family: w.family || w.id,
      ...(w.morph ? { morph: w.morph } : {}),
      tags: w.tags,
      meaning: w.meaning,
      examples: w.examples,
      derivatives: w.derivatives || []
    };
    fs.writeFileSync(path.join(outDir, w.id + ".json"), JSON.stringify(ordered, null, 2) + "\n", "utf8");
    n++;
  }
  console.log(`✓ 导出 ${n} 个单词到 ${path.relative(ROOT, outDir) || outDir}`);
}

function help() {
  console.log(`单词卡片 CLI（API 模式，数据源：服务端 SQLite）
  WORDS_API_URL / WORDS_API_TOKEN 见文件头注释
  node tools/words.js family <word>        查重 + 查同根词族（录入前必跑）
  node tools/words.js search <keyword>     模糊搜索（单词/释义/标签）
  node tools/words.js index                输出精简索引
  node tools/words.js add --file <path>    新增单词（也可用 stdin；需 TOKEN）
  node tools/words.js update --file <path> 更新已有单词（也可用 stdin；需 TOKEN）
  node tools/words.js export [--dir <p>]   全量数据快照为 JSON 文件（备份）`);
}

(async function () {
  const [cmd, ...rest] = process.argv.slice(2);
  const fileIdx = rest.indexOf("--file");
  const fileArg = fileIdx >= 0 ? rest[fileIdx + 1] : null;
  const dirIdx = rest.indexOf("--dir");
  const dirArg = dirIdx >= 0 ? rest[dirIdx + 1] : null;
  const posArg = rest
    .filter((a, i) => a !== "--file" && a !== fileArg && a !== "--dir" && a !== dirArg)
    .join(" ")
    .trim();

  try {
    switch (cmd) {
      case "family":
        await cmdFamily(posArg);
        break;
      case "search":
        await cmdSearch(posArg);
        break;
      case "index":
        await cmdIndex();
        break;
      case "add":
        await cmdUpsert("add", fileArg);
        break;
      case "update":
        await cmdUpsert("update", fileArg);
        break;
      case "export":
        await cmdExport(dirArg);
        break;
      default:
        help();
    }
  } catch (e) {
    fail("请求失败: " + (e && e.message ? e.message : e) + `（目标 ${API}）`);
  }
})();
