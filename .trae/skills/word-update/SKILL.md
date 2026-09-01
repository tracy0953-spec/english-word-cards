---
name: "word-update"
description: "Adds or updates a word entry in the word-cards dataset through the project CLI (tools/words.js add/update), which calls the Express backend API; the server validates and persists to SQLite. Invoke when the user sends a word/phrase to record or asks to add/update vocabulary."
---

# 新增 / 更新单词（API 写入 SQLite）

把用户发来的单词/短语录入单词卡片项目。**所有写入必须通过 CLI（走后端 API）**，禁止手工改数据库，也不要直接编辑 `data/words/*.json`（那只是种子/备份快照）。

工作目录：项目根目录（含 `tools/words.js`）。

## 环境变量

- `WORDS_API_URL`：服务地址，默认 `http://127.0.0.1:3000`；录线上 VPS 的词时设为 `https://你的域名`。
- `WORDS_API_TOKEN`：写入令牌，等于服务端启动时的 `ADMIN_TOKEN`。**add/update 必需**，没配会返回 401/503。

## 流程

### 1. 查重 + 查词族（先跑，只读，不需要 token）

```bash
node tools/words.js family <word>
```

- `"found": true` → 该词已存在，走 **update**（在原词基础上补充，不要漏字段）。
  拿现有内容用：`node tools/words.js search <word>`，或直接 `curl -s $WORDS_API_URL/api/words/<id>`，合并后再提交。
- `"found": false` 且有 `familySuggestions` → 走 **add**，`family` 填建议主词 id。
- `"found": false` 且无建议 → 走 **add**，`family` 填自身 id（或省略，默认指向自身）。

### 2. 生成词条 JSON（AI 的核心工作）

把词条写成一个 JSON 对象，**用 Write 工具写到临时文件** `/tmp/word-card-entry.json`（不要直接写进项目目录）。字段规则（详见 AGENTS.md）：

- `word`：原词；`id` 可省略，服务端按"小写、空格转连字符"自动生成。
- `phonetic`：美音音标；短语（phr. 或含空格）省略。
- `pos`：n. / v. / adj. / adv. / phr.。
- `family`：词族主词 id（第 1 步的结论），缺省指向自身。
- `morph`：相对主词的构词说明，如 `"-ion 名词后缀（动词→名词，表行为/结果）"`；主词省略。
- `tags`：3~6 个，**必须含一个频率标签**（高频/中频/低频），只能用 AGENTS.md 标签体系中的值。
- `meaning`：中文释义，多义用 `；` 分隔。
- `examples`：**至少 2 个**，每个含 `en` 和 `zh`；偏口语/日常的词至少 1 个口语化例句（日常对话，可用 I'm / gonna 等缩写）。
- `derivatives`：只放"还没有独立卡片"的同族词（含 word/phonetic/meaning，**不要带 pos 字段**）；已有卡片的同族词由 family 自动关联，不要写。

### 3. 用 CLI 写入（服务端校验 + 写 SQLite）

```bash
# 新增：
WORDS_API_TOKEN=<ADMIN_TOKEN> node tools/words.js add --file /tmp/word-card-entry.json
# 更新已有：
WORDS_API_TOKEN=<ADMIN_TOKEN> node tools/words.js update --file /tmp/word-card-entry.json
```

- 服务端做完整校验（字段、例句数、标签合法且含频率、音标、family 指向、重复单词），**校验不过不会写库**，错误逐条打印。
- 成功后输出 JSON 结果（family 成员、标签、例句数、总词数/词族数），页面刷新即可见（前端直接读 API，无需重新构建）。
- 报错时：修改 `/tmp/word-card-entry.json` 后**重新运行同一条命令**，直到输出 `"ok": true`。不要手工绕过校验。
- add 提示已存在（409）→ 改 update；update 提示不存在（404）→ 改 add。
- 401 → token 错误/未设置；连接失败 → 服务未启动或 WORDS_API_URL 不对。

### 4. 汇报

向用户简要说明：新增还是更新、单词、归入词族（family）、morph、例句数、服务端返回的总词数/词族数。

## 批量录入

用户一次发多个词时：**逐词执行** 1→3 步（每个词单独 family 查询、单独 add/update），避免一次写入多个词条出错互相牵连。

## 禁忌

- 不手工编辑数据库或 `data/words/` 下文件；数据备份用 `node tools/words.js export`。
- 不自创标签；不省略频率标签；例句不少于 2 个。
- family 指向不存在的主词会被校验拒绝：先建主词再建派生词。
