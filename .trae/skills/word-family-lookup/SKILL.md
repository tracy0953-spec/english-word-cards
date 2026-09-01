---
name: "word-family-lookup"
description: "Looks up words sharing the same root/word-family or similar morphology in the word-cards dataset via the project CLI (tools/words.js), which queries the Express/SQLite backend over HTTP. Invoke before adding a new word, or when the user asks about related/derived words (e.g. construct vs construction). Read-only; do not edit files."
---

# 单词词族 / 相近结构查询（只读）

在单词卡片项目中查询某个词是否已存在、属于哪个词族。**新增单词前必须先执行**（word-update 的第一步）。

数据源是后端 SQLite，CLI 通过 HTTP API 查询，不要手工 grep/翻文件。工作目录为项目根目录。
- 默认查询本地服务 `http://127.0.0.1:3000`；查询线上 VPS 时先 `export WORDS_API_URL=https://你的域名`。
- 查询接口不需要 token。

## 命令

```bash
# 1) 查词族（查重 + 词根建议，录入前必跑）
node tools/words.js family <word>
```

输出解读（JSON）：

- `"found": true`：该词已有卡片，`members` 是同 family 的全部成员（含主词），`family` 是词族主词 id。
- `"found": false`：
  - `familySuggestions`：按词干/后缀自动找到的候选词族（`family` 字段即建议主词 id）；
  - `inlineMentions`：该词是否只作为别人 derivatives 内联条目出现；
  - `candidateStems`：剥掉后缀后的候选词干（-tion/-ly/-ness 等）；
  - `hint`：直接给出 family 该怎么填。

```bash
# 2) 模糊搜索（英文单词片段 / 中文释义 / 标签）
node tools/words.js search <keyword>

# 3) 需要通览全部词时，读精简索引（一词一行，极省 token）
node tools/words.js index
```

## 判断规则

1. 目标词 `found: true` → 不要新建，交给 word-update 走 update。
2. `found: false` 但有 `familySuggestions` → 新词的 `family` 填建议主词 id，并写 `morph`（如 `-ion 名词后缀（动词→名词）`）。
3. `found: false` 且无建议 → 新词作为新主词，`family` 填自身 id。
4. 查询结果包含 family、morph、成员 id 等，直接传给 word-update 或汇报给用户。

## 约束

- 本技能只读：不创建/修改/删除任何文件，不运行 add/update。
- 命令退出码非 0（如服务未启动、连接失败）时，按报错信息处理，不要猜测数据。
