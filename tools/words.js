#!/usr/bin/env node
/**
 * 单词卡片数据 CLI —— 查询 / 写入 / 校验 / 打包的唯一入口
 *
 * 用法：
 *   node tools/words.js family <word>           查重 + 查词族（录入前必跑）
 *   node tools/words.js search <keyword>        模糊搜索（英文单词/中文释义/标签）
 *   node tools/words.js index                    输出精简索引（省 token 用）
 *   node tools/words.js add --file <path>        新增单词（JSON 文件或标准输入）
 *   node tools/words.js update --file <path>     更新已有单词
 *   node tools/words.js validate                 只校验，不生成产物
 *   node tools/words.js build                    校验通过后生成 data/bundle.js 与 data/index.json
 *
 * add / update 的输入：单个单词 JSON 对象（字段见 AGENTS.md），
 * 通过 --file <path> 传入，或从 stdin 管道传入。脚本负责：
 * 规范化 id/文件名 → 完整校验 → 原子写入 → 重新生成产物。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WORDS_DIR = path.join(ROOT, "data", "words");
const BUNDLE = path.join(ROOT, "data", "bundle.js");
const INDEX = path.join(ROOT, "data", "index.json");

const ALLOWED_TAGS = {
  "频率": ["高频", "中频", "低频"],
  "风格": ["偏口语", "通用", "偏书面", "正式", "学术"],
  "表达功能": ["日常动作", "情绪感受", "态度立场", "观点评价", "人际交流", "描述人物", "描述事物", "空间位置", "时间顺序", "数量程度", "变化趋势"],
  "逻辑关系": ["因果", "对比", "转折", "递进", "条件", "让步", "举例", "总结", "强调", "顺序"],
  "场景主题": ["生活", "家庭", "工作", "教育", "科技", "AI", "商业", "经济", "环境", "社会", "新闻", "医疗健康", "自然生物", "交通旅行", "文化艺术"],
  "雅思用途": ["雅思口语", "雅思写作", "雅思阅读", "雅思听力"],
  "语言特征": ["固定搭配", "常见介词", "一词多义", "易混词", "词性变化", "短语动词", "习语", "搭配词"]
};
const FREQ_TAGS = ALLOWED_TAGS["频率"];
const TAG_SET = new Set(Object.values(ALLOWED_TAGS).flat());

const SUFFIXES = [
  ["tion", 4], ["sion", 4], ["ment", 4], ["ness", 4], ["ity", 3], ["ively", 6],
  ["able", 4], ["ible", 4], ["fully", 5], ["less", 4], ["ous", 3], ["ive", 3],
  ["ally", 4], ["ly", 2], ["er", 2], ["or", 2], ["al", 2], ["ed", 2],
  ["ing", 3], ["es", 2], ["s", 1]
];

function idOf(word) {
  return String(word || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function isPhrase(w) {
  return !w.pos || w.pos === "phr." || String(w.word || "").includes(" ");
}

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    return "";
  }
}

function loadAll() {
  if (!fs.existsSync(WORDS_DIR)) return { entries: [], loadErrors: [] };
  const files = fs.readdirSync(WORDS_DIR).filter(f => f.endsWith(".json"));
  const entries = [];
  const loadErrors = [];
  for (const f of files) {
    const full = path.join(WORDS_DIR, f);
    let w;
    try {
      w = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
      loadErrors.push(`[${f}] JSON 解析失败: ${e.message}`);
      continue;
    }
    w.__file = f;
    entries.push(w);
  }
  return { entries, loadErrors };
}

function validateEntry(w, label, ctx) {
  const errors = [];
  const warns = [];
  ctx = ctx || { ids: new Set(), words: new Map() };

  if (!w.id) errors.push(`${label} 缺少 id 字段`);
  if (!w.word || typeof w.word !== "string") errors.push(`${label} 缺少 word`);
  if (!w.meaning || typeof w.meaning !== "string") errors.push(`${label} 缺少 meaning`);

  if (!Array.isArray(w.tags) || w.tags.length === 0) {
    errors.push(`${label} tags 必须是非空数组`);
  } else {
    if (!FREQ_TAGS.some(t => w.tags.includes(t))) {
      errors.push(`${label} tags 中必须包含一个频率标签（高频/中频/低频）`);
    }
    for (const t of w.tags) {
      if (!TAG_SET.has(t)) errors.push(`${label} 非法标签 "${t}"（不在标签体系中，见 AGENTS.md）`);
    }
  }

  if (!Array.isArray(w.examples)) {
    errors.push(`${label} examples 必须是数组`);
  } else if (w.examples.length < 2) {
    errors.push(`${label} examples 至少需要 2 个例句（当前 ${w.examples.length} 个）`);
  } else {
    w.examples.forEach((ex, i) => {
      if (!ex || !ex.en || !ex.zh) errors.push(`${label} examples[${i}] 必须同时包含 en 和 zh`);
    });
  }

  if (w.word && !isPhrase(w) && !w.phonetic) {
    errors.push(`${label} 单词（非短语）必须有 phonetic 美音音标`);
  }

  if (!w.family) {
    warns.push(`${label} 未填 family，已默认指向自身`);
  } else if (w.family !== w.id && !ctx.ids.has(w.family)) {
    errors.push(`${label} family="${w.family}" 指向的主词卡片不存在（请先创建主词，或把 family 指向自身 id）`);
  }

  if (w.derivatives == null) {
    w.derivatives = [];
  } else if (!Array.isArray(w.derivatives)) {
    errors.push(`${label} derivatives 必须是数组`);
  } else {
    w.derivatives.forEach((d, i) => {
      if (!d || !d.word || !d.meaning) {
        errors.push(`${label} derivatives[${i}] 缺少 word 或 meaning`);
      } else if (ctx.words.has(idOf(d.word)) && !d.ref) {
        warns.push(`${label} 衍生词 "${d.word}" 已有独立卡片，会通过 family 自动关联，建议从 derivatives 中删除该条`);
      } else if (d.ref && !ctx.ids.has(d.ref)) {
        errors.push(`${label} derivatives[${i}].ref="${d.ref}" 指向的卡片不存在`);
      }
    });
  }

  if (w.id && w.__file && w.id !== w.__file.replace(/\.json$/, "")) {
    errors.push(`${label} id "${w.id}" 与文件名 ${w.__file} 不一致`);
  }
  if (ctx.ids.has(w.id)) errors.push(`${label} id "${w.id}" 与已有卡片重复`);
  if (w.word && ctx.words.has(idOf(w.word))) {
    errors.push(`${label} 单词 "${w.word}" 已存在（${ctx.words.get(idOf(w.word))}）`);
  }

  return { errors, warns };
}

function validateAll(entries) {
  const errors = [];
  const warns = [];
  for (let i = 0; i < entries.length; i++) {
    const w = entries[i];
    const others = entries.filter((_, j) => j !== i);
    const ctx = {
      ids: new Set(others.map(e => e.id)),
      words: new Map(others.map(e => [idOf(e.word), e.__file || (e.id + ".json")]))
    };
    const r = validateEntry(w, `[${w.__file || w.id}]`, ctx);
    errors.push(...r.errors);
    warns.push(...r.warns);
  }
  return { errors, warns };
}

function compactEntry(w) {
  const o = { id: w.id, word: w.word, family: w.family || w.id, tags: w.tags };
  if (w.pos) o.pos = w.pos;
  if (w.morph) o.morph = w.morph.split(/\s+/)[0];
  return o;
}

function writeBundle(entries) {
  const sorted = entries.slice().sort((a, b) => a.word.localeCompare(b.word));
  const families = {};
  for (const w of sorted) {
    const f = w.family || w.id;
    (families[f] = families[f] || []).push(w.word);
  }
  const clean = sorted.map(w => {
    const o = {
      id: w.id,
      word: w.word,
      family: w.family || w.id,
      tags: w.tags,
      meaning: w.meaning,
      examples: w.examples,
      derivatives: w.derivatives || []
    };
    if (w.phonetic) o.phonetic = w.phonetic;
    if (w.pos) o.pos = w.pos;
    if (w.morph) o.morph = w.morph;
    return o;
  });

  const bundle =
    "// AUTO-GENERATED by tools/words.js build — 请勿手动编辑；数据源在 data/words/*.json\n" +
    "window.WORD_DATA = " +
    JSON.stringify({
      meta: {
        version: 2,
        generatedAt: new Date().toISOString().slice(0, 10),
        count: clean.length,
        families: Object.keys(families).length
      },
      words: clean
    }, null, 2) +
    ";\n";
  fs.writeFileSync(BUNDLE, bundle, "utf8");

  const index = sorted.map(compactEntry);
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n", "utf8");

  return { clean, families };
}

function atomicWrite(file, content) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function printFamilyReport(entry, entries) {
  const fam = entry.family || entry.id;
  const members = entries
    .filter(e => (e.family || e.id) === fam)
    .sort((a, b) => a.word.localeCompare(b.word))
    .map(e => ({
      id: e.id,
      word: e.word,
      pos: e.pos || "",
      morph: e.morph ? e.morph.split(/\s+/)[0] : "(主词)",
      file: e.__file
    }));
  const out = {
    target: entry.word,
    found: true,
    file: entry.__file,
    family: fam,
    familyHead: members[0] ? members.find(m => m.id === fam)?.word || fam : fam,
    members: members,
    hint: `新词若属于本词族：family 填 "${fam}"，并写 morph 后缀说明`
  };
  console.log(JSON.stringify(out, null, 2));
}

function suggestStems(word) {
  const base = idOf(word).replace(/-/g, "");
  const stems = new Set();
  for (const [suf, len] of SUFFIXES) {
    if (base.endsWith(suf) && base.length - len >= 3) {
      const stem = base.slice(0, base.length - len);
      stems.add(stem);
      if (suf === "tion" || suf === "sion" || suf === "sive") stems.add(stem + "t");
      if (suf === "ness" || suf === "ily" || suf === "ful") {
        stems.add(stem.replace(/i$/, "y"));
      }
      if (suf === "ly") stems.add(stem.replace(/i$/, "y"));
    }
  }
  return [...stems];
}

function cmdFamily(word) {
  if (!word) fail("用法：node tools/words.js family <word>");
  const { entries } = loadAll();
  const norm = idOf(word);
  const entry = entries.find(e => e.id === norm || idOf(e.word) === norm);
  if (entry) {
    printFamilyReport(entry, entries);
    return;
  }

  const stems = suggestStems(word);
  const suggestions = [];
  for (const e of entries) {
    const eNorm = idOf(e.word).replace(/-/g, "");
    const hitStem = stems.find(s => eNorm.startsWith(s) || (e.family || "").includes(s));
    if (hitStem || idOf(e.word).includes(norm) || norm.includes(idOf(e.word))) {
      suggestions.push({ id: e.id, word: e.word, family: e.family || e.id, pos: e.pos || "", matchedStem: hitStem || "" });
    }
  }
  const inlineHits = [];
  for (const e of entries) {
    for (const d of e.derivatives || []) {
      if (idOf(d.word) === norm) inlineHits.push({ mentionedIn: e.__file, as: "derivatives 内联条目" });
    }
  }
  console.log(JSON.stringify({
    target: word,
    found: false,
    candidateStems: stems,
    familySuggestions: suggestions,
    inlineMentions: inlineHits,
    hint: suggestions.length
      ? `疑似词族主词为 "${suggestions[0].family}"：新建卡片时 family 填它，morph 写后缀说明；或先补建主词`
      : "未找到相近结构词；新建卡片时 family 填自身 id（作为新词族主词）"
  }, null, 2));
}

function cmdSearch(kw) {
  if (!kw) fail("用法：node tools/words.js search <keyword>");
  const { entries } = loadAll();
  const q = kw.toLowerCase();
  const hits = entries
    .filter(e =>
      e.word.toLowerCase().includes(q) ||
      (e.meaning || "").includes(kw) ||
      (e.tags || []).some(t => t.includes(kw))
    )
    .map(e => ({
      id: e.id,
      word: e.word,
      pos: e.pos || "",
      family: e.family || e.id,
      meaning: (e.meaning || "").split("；")[0]
    }));
  console.log(JSON.stringify({ keyword: kw, count: hits.length, hits }, null, 2));
}

function cmdIndex() {
  const { entries, loadErrors } = loadAll();
  if (loadErrors.length) {
    loadErrors.forEach(e => console.error(e));
    process.exit(1);
  }
  const index = entries.slice().sort((a, b) => a.word.localeCompare(b.word)).map(compactEntry);
  console.log(JSON.stringify(index, null, 2));
}

function cmdUpsert(mode, file) {
  let raw;
  if (file) {
    raw = fs.readFileSync(file, "utf8");
  } else {
    raw = readStdin();
  }
  if (!raw || !raw.trim()) fail("未读取到输入 JSON（用 --file <path> 或 stdin 传入）");

  let w;
  try {
    w = JSON.parse(raw);
  } catch (e) {
    fail("输入 JSON 解析失败: " + e.message);
  }
  if (!w || typeof w !== "object" || Array.isArray(w)) {
    fail("输入必须是单个单词 JSON 对象，不能是数组");
  }

  if (!w.word) fail("JSON 缺少 word 字段");
  w.id = w.id || idOf(w.word);
  w.word = String(w.word).trim();
  w.family = w.family || w.id;
  if (w.derivatives == null) w.derivatives = [];
  const targetFile = path.join(WORDS_DIR, w.id + ".json");
  const exists = fs.existsSync(targetFile);
  if (mode === "add" && exists) fail(`单词 "${w.word}" 已存在（${w.id}.json）；更新请用 update`);
  if (mode === "update" && !exists) fail(`单词 "${w.word}" 不存在（${w.id}.json）；新增请用 add`);

  const { entries, loadErrors } = loadAll();
  if (loadErrors.length) loadErrors.forEach(e => console.error("⚠ " + e));
  const ctxIds = new Set(entries.filter(e => e.id !== w.id).map(e => e.id));
  const ctxWords = new Map();
  for (const e of entries) {
    if (e.id !== w.id) ctxWords.set(idOf(e.word), e.__file);
  }
  w.__file = w.id + ".json";
  const { errors, warns } = validateEntry(w, `[${w.id}.json]`, { ids: ctxIds, words: ctxWords });
  if (errors.length) {
    errors.forEach(e => console.error("✗ " + e));
    fail(`共 ${errors.length} 个错误，未写入。请修正后重试。`);
  }
  warns.forEach(x => console.warn("⚠ " + x));

  const out = { ...w };
  delete out.__file;
  const ordered = {
    id: out.id,
    word: out.word,
    ...(out.phonetic ? { phonetic: out.phonetic } : {}),
    ...(out.pos ? { pos: out.pos } : {}),
    family: out.family,
    ...(out.morph ? { morph: out.morph } : {}),
    tags: out.tags,
    meaning: out.meaning,
    examples: out.examples,
    derivatives: out.derivatives
  };
  if (!fs.existsSync(WORDS_DIR)) fs.mkdirSync(WORDS_DIR, { recursive: true });
  atomicWrite(targetFile, JSON.stringify(ordered, null, 2) + "\n");

  const after = loadAll();
  const v = validateAll(after.entries);
  if (v.errors.length) {
    v.errors.forEach(e => console.error("✗ " + e));
    fail("写入后全量校验失败（本次写入已落盘，请按报错修正后重新 update）");
  }
  const { families } = writeBundle(after.entries);

  const famMembers = (families[w.family] || []).filter(x => idOf(x) !== idOf(w.word));
  console.log(JSON.stringify({
    ok: true,
    action: mode,
    file: "data/words/" + w.id + ".json",
    word: w.word,
    family: w.family,
    morph: w.morph || "",
    familyMembers: famMembers,
    examples: w.examples.length,
    tags: w.tags,
    totalWords: after.entries.length,
    totalFamilies: Object.keys(families).length
  }, null, 2));
}

function cmdBuild() {
  const { entries, loadErrors } = loadAll();
  const { errors, warns } = validateAll(entries);
  const all = loadErrors.concat(errors);
  warns.forEach(w => console.warn("⚠ " + w));
  if (all.length) {
    all.forEach(e => console.error("✗ " + e));
    fail(`共 ${all.length} 个错误，未生成产物。请修复后重新运行 node tools/words.js build`);
  }
  const { clean, families } = writeBundle(entries);
  console.log(`✓ 校验通过，已生成 data/bundle.js 与 data/index.json`);
  console.log(`  单词数: ${clean.length}，词族数: ${Object.keys(families).length}`);
  Object.entries(families)
    .filter(([, m]) => m.length > 1)
    .sort()
    .forEach(([f, m]) => console.log(`  词族 ${f}: ${m.sort().join(", ")}`));
}

function cmdValidate() {
  const { entries, loadErrors } = loadAll();
  const { errors, warns } = validateAll(entries);
  const all = loadErrors.concat(errors);
  warns.forEach(w => console.warn("⚠ " + w));
  if (all.length) {
    all.forEach(e => console.error("✗ " + e));
    fail(`共 ${all.length} 个错误`);
  }
  const families = new Set(entries.map(e => e.family || e.id));
  console.log(`✓ 校验通过：${entries.length} 个单词，${families.size} 个词族`);
}

function help() {
  console.log(`单词卡片数据 CLI
  node tools/words.js family <word>        查重 + 查同根词族（录入前必跑）
  node tools/words.js search <keyword>     模糊搜索（单词/释义/标签）
  node tools/words.js index                输出精简索引（id/word/pos/family/tags/morph）
  node tools/words.js add --file <path>    新增单词（也可用 stdin）
  node tools/words.js update --file <path> 更新已有单词（也可用 stdin）
  node tools/words.js validate             全量校验
  node tools/words.js build                校验并生成 data/bundle.js + data/index.json`);
}

const [cmd, ...rest] = process.argv.slice(2);
const fileIdx = rest.indexOf("--file");
const fileArg = fileIdx >= 0 ? rest[fileIdx + 1] : null;
const posArg = rest.filter(a => a !== "--file" && a !== fileArg).join(" ");

switch (cmd) {
  case "family": cmdFamily(posArg.trim()); break;
  case "search": cmdSearch(posArg.trim()); break;
  case "index": cmdIndex(); break;
  case "add": cmdUpsert("add", fileArg); break;
  case "update": cmdUpsert("update", fileArg); break;
  case "validate": cmdValidate(); break;
  case "build": cmdBuild(); break;
  default: help();
}
