---
name: "word-update"
description: "Adds or updates a word entry in the word-cards dataset through the project CLI (tools/words.js add/update), which validates, atomically writes data/words/<id>.json, and regenerates the H5 bundle. Invoke when the user sends a word/phrase to record or asks to add/update vocabulary."
---

# 新增 / 更新单词（CLI 写入）

把用户发来的单词/短语录入单词卡片项目。**所有写入必须通过 CLI 脚本**，禁止手工创建/修改 `data/words/*.json`，禁止手动编辑 `data/bundle.js`、`data/index.json`（均为脚本生成）。

工作目录：项目根目录（含 `tools/words.js`）。

## 流程

### 1. 查重 + 查词族（先跑，只读）

```bash
node tools/words.js family <word>
```

- `"found": true` → 该词已存在，走 **update**（在原词基础上补充，不要漏字段：先读 `data/words/<id>.json` 拿到现有内容，合并后再提交）。
- `"found": false` 且有 `familySuggestions` → 走 **add**，`family` 填建议主词 id。
- `"found": false` 且无建议 → 走 **add**，`family` 填自身 id（新词族主词）。

### 2. 生成词条 JSON（AI 的核心工作）

把词条写成一个 JSON 对象，**用 Write 工具写到临时文件** `/tmp/word-card-entry.json`（不要直接写进项目目录）。字段规则（详见 AGENTS.md）：

- `word`：原词；`id` 可省略，脚本会按"小写、空格转连字符"自动生成。
- `phonetic`：美音音标；短语（phr. 或含空格）省略。
- `pos`：n. / v. / adj. / adv. / phr.。
- `family`：词族主词 id（第 1 步的结论），必填，缺省会指向自身。
- `morph`：相对主词的构词说明，如 `"-ion 名词后缀（动词→名词，表行为/结果）"`；主词省略。
- `tags`：3~6 个，**必须含一个频率标签**（高频/中频/低频），只能用 AGENTS.md 标签体系中的值。
- `meaning`：中文释义，多义用 `；` 分隔。
- `examples`：**至少 2 个**，每个含 `en` 和 `zh`；偏口语/日常的词至少 1 个口语化例句（日常对话，可用 I'm / gonna 等缩写）。
- `derivatives`：只放"还没有独立卡片"的同族词；已有卡片的同族词由 family 自动关联，不要写。

### 3. 用脚本写入（校验 + 原子写 + 自动重建产物）

```bash
# 新增：
node tools/words.js add --file /tmp/word-card-entry.json
# 更新已有：
node tools/words.js update --file /tmp/word-card-entry.json
```

- 脚本会做完整校验（字段、例句数、标签合法且含频率、音标、family 指向、重复单词），**校验不过不会写任何文件**，输出每条错误。
- 通过后自动写入 `data/words/<id>.json` 并重新生成 `data/bundle.js` + `data/index.json`，输出 JSON 结果（family 成员、标签、例句数等）。
- 报错时：修改 `/tmp/word-card-entry.json` 后**重新运行同一条命令**，直到输出 `"ok": true`。不要手工绕过校验。
- update 若提示不存在 / add 提示已存在，按提示切换命令。

### 4. 汇报

向用户简要说明：新增还是更新、单词、归入词族（family）、morph、例句数、脚本输出的总词数/词族数。

## 批量录入

用户一次发多个词时：**逐词执行** 1→3 步（每个词单独 family 查询、单独 add/update），避免一次写入多个词条出错互相牵连。

## 禁忌

- 不手工编辑 `data/words/` 下任何文件、不手工改 `bundle.js` / `index.json`。
- 不自创标签；不省略频率标签；例句不少于 2 个。
- family 指向不存在的主词会被校验拒绝：先建主词再建派生词。
