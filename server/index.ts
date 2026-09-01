import express, { Request, Response, NextFunction, RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { listWords, getWord, upsertWord, countWords, WordEntry } from "./db";
import {
  validateEntry,
  validateAll,
  normalizeEntry,
  idOf,
  suggestStems
} from "./validate";

const app = express();
app.use(express.json({ limit: "1mb" }));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const PORT = Number(process.env.PORT) || 3000;

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ ok: false, error: "服务端未设置 ADMIN_TOKEN，写入接口未启用" });
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "token 无效（需要 Authorization: Bearer <ADMIN_TOKEN>）" });
  }
  next();
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, count: countWords(), writesEnabled: !!ADMIN_TOKEN });
});

app.get("/api/words", (_req: Request, res: Response) => {
  const words = listWords().sort((a, b) => a.word.localeCompare(b.word));
  const families = new Set(words.map((w) => w.family || w.id));
  res.json({
    meta: { count: words.length, families: families.size },
    words
  });
});

app.get("/api/words/:id", (req: Request, res: Response) => {
  const w = getWord(req.params.id);
  if (!w) return res.status(404).json({ ok: false, error: "单词不存在" });
  res.json(w);
});

app.get("/api/family", (req: Request, res: Response) => {
  const word = String(req.query.word || "").trim();
  if (!word) return res.status(400).json({ ok: false, error: "缺少 word 参数" });

  const entries = listWords();
  const norm = idOf(word);
  const entry = entries.find((e) => e.id === norm || idOf(e.word) === norm);

  if (entry) {
    const fam = entry.family || entry.id;
    const members = entries
      .filter((e) => (e.family || e.id) === fam)
      .sort((a, b) => a.word.localeCompare(b.word))
      .map((e) => ({
        id: e.id,
        word: e.word,
        pos: e.pos || "",
        morph: e.morph ? e.morph.split(/\s+/)[0] : "(主词)"
      }));
    return res.json({
      target: word,
      found: true,
      id: entry.id,
      family: fam,
      members,
      hint: `新词若属于本词族：family 填 "${fam}"，并写 morph 后缀说明`
    });
  }

  const stems = suggestStems(word);
  const suggestions: any[] = [];
  for (const e of entries) {
    const eNorm = idOf(e.word).replace(/-/g, "");
    const hitStem = stems.find((s) => eNorm.startsWith(s) || (e.family || "").includes(s));
    if (hitStem || idOf(e.word).includes(norm) || norm.includes(idOf(e.word))) {
      suggestions.push({
        id: e.id,
        word: e.word,
        family: e.family || e.id,
        pos: e.pos || "",
        matchedStem: hitStem || ""
      });
    }
  }
  const inlineHits: any[] = [];
  for (const e of entries) {
    for (const d of e.derivatives || []) {
      if (idOf(d.word) === norm) {
        inlineHits.push({ mentionedIn: e.id, as: "derivatives 内联条目" });
      }
    }
  }
  res.json({
    target: word,
    found: false,
    candidateStems: stems,
    familySuggestions: suggestions,
    inlineMentions: inlineHits,
    hint: suggestions.length
      ? `疑似词族主词为 "${suggestions[0].family}"：新建卡片时 family 填它，morph 写后缀说明；或先补建主词`
      : "未找到相近结构词；新建卡片时 family 填自身 id（作为新词族主词）"
  });
});

app.get("/api/search", (req: Request, res: Response) => {
  const kw = String(req.query.q || "").trim();
  if (!kw) return res.status(400).json({ ok: false, error: "缺少 q 参数" });
  const q = kw.toLowerCase();
  const hits = listWords()
    .filter(
      (e) =>
        e.word.toLowerCase().includes(q) ||
        (e.meaning || "").includes(kw) ||
        (e.tags || []).some((t) => t.includes(kw))
    )
    .map((e) => ({
      id: e.id,
      word: e.word,
      pos: e.pos || "",
      family: e.family || e.id,
      meaning: (e.meaning || "").split("；")[0]
    }));
  res.json({ keyword: kw, count: hits.length, hits });
});

function upsertHandler(mode: "add" | "update"): RequestHandler {
  return (req: Request, res: Response) => {
    const { entry, errors: normErrors } = normalizeEntry(req.body);
    if (!entry) return res.status(400).json({ ok: false, errors: normErrors });

    if (mode === "add" && getWord(entry.id)) {
      return res.status(409).json({ ok: false, error: `单词 "${entry.word}" 已存在（id=${entry.id}）；更新请用 PUT` });
    }
    if (mode === "update" && !getWord(entry.id)) {
      return res.status(404).json({ ok: false, error: `单词 "${entry.word}" 不存在（id=${entry.id}）；新增请用 POST` });
    }

    const others = listWords().filter((e) => e.id !== entry!.id);
    const ctx = {
      ids: new Set(others.map((e) => e.id)),
      words: new Map(others.map((e) => [idOf(e.word), e.id]))
    };
    const { errors, warns } = validateEntry(entry, `[${entry.id}]`, ctx);
    if (errors.length) {
      return res.status(400).json({ ok: false, errors, warns });
    }

    upsertWord(entry);

    const after = listWords();
    const full = validateAll(after);
    if (full.errors.length) {
      return res.status(400).json({
        ok: false,
        errors: full.errors,
        note: "写入已落库但全量校验失败，请按报错修正后重新 update"
      });
    }

    const fam = entry.family || entry.id;
    const familyMembers = after
      .filter((e) => (e.family || e.id) === fam && e.id !== entry!.id)
      .map((e) => e.word);
    const families = new Set(after.map((e) => e.family || e.id));

    res.json({
      ok: true,
      action: mode,
      id: entry.id,
      word: entry.word,
      family: fam,
      morph: entry.morph || "",
      familyMembers,
      examples: entry.examples.length,
      tags: entry.tags,
      warns,
      totalWords: after.length,
      totalFamilies: families.size
    });
  };
}

app.post("/api/words", requireAuth, upsertHandler("add"));
app.put("/api/words/:id", requireAuth, (req, res, next) => {
  req.body = req.body || {};
  req.body.id = req.params.id;
  upsertHandler("update")(req, res, next);
});

// ---------- 静态前端（生产环境：vite build 产物 dist/） ----------
const DIST_DIR = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
} else {
  app.get("/", (_req: Request, res: Response) => {
    res.send("前端未构建：请先运行 npm run build（开发模式用 npm run dev）");
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[word-cards] server on http://0.0.0.0:${PORT}  (writes: ${ADMIN_TOKEN ? "enabled" : "disabled"})`);
});
