import { WordEntry } from "./db";

export const ALLOWED_TAGS: Record<string, string[]> = {
  "频率": ["高频", "中频", "低频"],
  "风格": ["偏口语", "通用", "偏书面", "正式", "学术"],
  "表达功能": ["日常动作", "情绪感受", "态度立场", "观点评价", "人际交流", "描述人物", "描述事物", "空间位置", "时间顺序", "数量程度", "变化趋势"],
  "逻辑关系": ["因果", "对比", "转折", "递进", "条件", "让步", "举例", "总结", "强调", "顺序"],
  "场景主题": ["生活", "家庭", "工作", "教育", "科技", "AI", "商业", "经济", "环境", "社会", "新闻", "医疗健康", "自然生物", "交通旅行", "文化艺术"],
  "雅思用途": ["雅思口语", "雅思写作", "雅思阅读", "雅思听力"],
  "语言特征": ["固定搭配", "常见介词", "一词多义", "易混词", "词性变化", "短语动词", "习语", "搭配词"]
};

export const FREQ_TAGS = ALLOWED_TAGS["频率"];
export const TAG_SET = new Set(Object.values(ALLOWED_TAGS).flat());

const SUFFIXES: [string, number][] = [
  ["tion", 4], ["sion", 4], ["ment", 4], ["ness", 4], ["ity", 3], ["ively", 6],
  ["able", 4], ["ible", 4], ["fully", 5], ["less", 4], ["ous", 3], ["ive", 3],
  ["ally", 4], ["ly", 2], ["er", 2], ["or", 2], ["al", 2], ["ed", 2],
  ["ing", 3], ["es", 2], ["s", 1]
];

export function idOf(word: string): string {
  return String(word || "").trim().toLowerCase().replace(/\s+/g, "-");
}

export function isPhrase(w: { word?: string; pos?: string }): boolean {
  return !w.pos || w.pos === "phr." || String(w.word || "").includes(" ");
}

export interface ValidationResult {
  errors: string[];
  warns: string[];
}

export function validateEntry(
  w: any,
  label: string,
  ctx: { ids: Set<string>; words: Map<string, string> }
): ValidationResult {
  const errors: string[] = [];
  const warns: string[] = [];

  if (!w.id) errors.push(`${label} 缺少 id 字段`);
  if (!w.word || typeof w.word !== "string") errors.push(`${label} 缺少 word`);
  if (!w.meaning || typeof w.meaning !== "string") errors.push(`${label} 缺少 meaning`);

  if (!Array.isArray(w.tags) || w.tags.length === 0) {
    errors.push(`${label} tags 必须是非空数组`);
  } else {
    if (!FREQ_TAGS.some((t) => w.tags.includes(t))) {
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
    w.examples.forEach((ex: any, i: number) => {
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
    w.derivatives.forEach((d: any, i: number) => {
      if (!d || !d.word || !d.meaning) {
        errors.push(`${label} derivatives[${i}] 缺少 word 或 meaning`);
      } else if (ctx.words.has(idOf(d.word)) && !d.ref) {
        warns.push(`${label} 衍生词 "${d.word}" 已有独立卡片，会通过 family 自动关联，建议从 derivatives 中删除该条`);
      } else if (d.ref && !ctx.ids.has(d.ref)) {
        errors.push(`${label} derivatives[${i}].ref="${d.ref}" 指向的卡片不存在`);
      }
    });
  }

  if (ctx.ids.has(w.id)) errors.push(`${label} id "${w.id}" 与已有卡片重复`);
  if (w.word && ctx.words.has(idOf(w.word))) {
    errors.push(`${label} 单词 "${w.word}" 已存在（${ctx.words.get(idOf(w.word))}）`);
  }

  return { errors, warns };
}

export function validateAll(entries: WordEntry[]): ValidationResult {
  const errors: string[] = [];
  const warns: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const w = entries[i];
    const others = entries.filter((_, j) => j !== i);
    const ctx = {
      ids: new Set(others.map((e) => e.id)),
      words: new Map(others.map((e) => [idOf(e.word), e.id]))
    };
    const r = validateEntry(w, `[${w.id}]`, ctx);
    errors.push(...r.errors);
    warns.push(...r.warns);
  }
  return { errors, warns };
}

/** 规范化外部输入：补 id / family / derivatives 默认值，返回干净的 WordEntry */
export function normalizeEntry(input: any): { entry?: WordEntry; errors: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { errors: ["输入必须是单个单词 JSON 对象，不能是数组"] };
  }
  if (!input.word) return { errors: ["JSON 缺少 word 字段"] };
  const word = String(input.word).trim();
  const entry: WordEntry = {
    id: input.id ? String(input.id) : idOf(word),
    word,
    phonetic: input.phonetic ? String(input.phonetic).trim() : "",
    pos: input.pos ? String(input.pos).trim() : "",
    family: input.family ? String(input.family).trim() : idOf(word),
    morph: input.morph ? String(input.morph).trim() : "",
    tags: Array.isArray(input.tags) ? input.tags.map((t: any) => String(t)) : [],
    meaning: String(input.meaning || "").trim(),
    examples: Array.isArray(input.examples) ? input.examples : [],
    derivatives: Array.isArray(input.derivatives) ? input.derivatives : []
  };
  return { entry, errors: [] };
}

export function suggestStems(word: string): string[] {
  const base = idOf(word).replace(/-/g, "");
  const stems = new Set<string>();
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
