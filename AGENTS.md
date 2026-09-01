# AGENTS.md — 单词卡片数据维护指南

本项目是**可编译的全栈应用**：Vue 3 + Vant 4 前端（Vite 构建）+ Express + TypeScript 后端 + SQLite 存储，部署在 VPS 上。
Agent 的职责是**维护单词数据**（通过后端 API），一般不需要改动前后端代码。

> 本项目配有两个专用 skill（.trae/skills/），处理单词任务时应优先使用：
> - **word-family-lookup**：查同根/同词族/相近结构的词
> - **word-update**：新增或更新单词的标准流程

## 架构与数据流

```
H5 (Vite build → dist/)  ──GET /api/words──▶  Express 服务  ──▶  SQLite (data/words.db)
Agent ── tools/words.js (CLI) ──POST/PUT /api/words ──▶ 服务端校验 ──▶ SQLite
```

- **权威数据源是 VPS 上的 SQLite**（`data/words.db`），不是 JSON 文件。
- `data/words/*.json` 只是**种子/备份快照**：首次部署用 `npm run seed` 导入；可用 `export` 命令从数据库拉取最新快照。
- 前端不再读 bundle.js；页面打开时请求 `/api/words`，筛选/搜索仍在前端 JS 中完成。

## 项目结构

- `server/` — Express + TypeScript 后端
  - `server/index.ts` — REST API、token 鉴权、托管 `dist/` 静态产物
  - `server/db.ts` — SQLite 建表与读写（better-sqlite3）
  - `server/validate.ts` — 写入校验（标签体系、例句、family 引用等），与 CLI 同规则
  - `server/seed.ts` — 把 `data/words/*.json` 导入数据库（幂等）
- `src/` — Vue 3 SFC 前端（Vite 构建到 `dist/`）
- `tools/words.js` — **Agent 录词用的 CLI 客户端**（走 HTTP API，不直接碰数据库）
- `data/words/` — JSON 种子/快照；`data/words.db`（运行时数据库，不提交 git）

## CLI 命令（node tools/words.js ...）

CLI 通过环境变量定位服务：

| 环境变量 | 说明 |
|---|---|
| `WORDS_API_URL` | 服务地址，默认 `http://127.0.0.1:3000`；录线上 VPS 的词时设为 `https://你的域名` |
| `WORDS_API_TOKEN` | 写入令牌，等于服务端启动时的 `ADMIN_TOKEN`（add/update 必需；查询不需要） |

| 命令 | 作用 |
|---|---|
| `family <word>` | 查重 + 查同根词族；未录入时按后缀（-tion/-ly/-ness 等）给出词族主词建议 |
| `search <keyword>` | 模糊搜索单词 / 中文释义 / 标签 |
| `index` | 输出精简索引（省 token 通览全部词） |
| `add --file <path>` | 新增单词：服务端校验 → 写 SQLite（已存在则返回 409） |
| `update --file <path>` | 更新已有单词（词必须已存在，否则 404） |
| `export [--dir <p>]` | 从数据库拉全量快照为 JSON 文件（备份，默认 `data/words/`） |

- add/update 的输入是单个单词 JSON 对象，通过 `--file` 传入（可先写到 `/tmp/word-card-entry.json`），也支持 stdin。
- **校验不过不会写库**；错误逐条打印，修正后重跑同一命令即可。
- API 一览：`GET /api/health`、`GET /api/words`、`GET /api/words/:id`、`GET /api/family?word=`、`GET /api/search?q=`、`POST /api/words`（写）、`PUT /api/words/:id`（写）。写入接口需 `Authorization: Bearer <ADMIN_TOKEN>`。

## 数据结构（写入 API 的 JSON 对象 / 数据库 words 表）

```json
{
  "id": "construction",
  "word": "construction",
  "phonetic": "/kənˈstrʌkʃən/",
  "pos": "n.",
  "family": "construct",
  "morph": "-ion 名词后缀（动词→名词，表行为/结果）",
  "tags": ["高频", "通用", "描述事物", "工作", "词性变化"],
  "meaning": "建设；建造；建筑物；结构",
  "examples": [
    { "en": "...", "zh": "..." },
    { "en": "...", "zh": "..." }
  ],
  "derivatives": []
}
```

字段规则：

- `id`：单词/短语小写，空格转连字符（`look forward to` → `look-forward-to`）；可省略，服务端按 word 自动生成。
- `word`：单词或短语原样（短语含空格）。
- `phonetic`：**美音**音标；短语（`pos: "phr."` 或含空格）省略此字段。
- `pos`：词性，如 `n.` `v.` `adj.` `adv.` `phr.`。
- `family`：**词族主词 id**。同根词共享同一个值，取最基础形态（通常是动词/形容词/名词原形）。
  如 `construct / construction / constructive / constructively` 的 `family` 都是 `"construct"`；
  单词自身就是主词时 `family` 等于自己的 `id`（可省略，默认指向自身）。
- `morph`：本词相对主词的构词说明，主词省略。如 `-ly 副词后缀（形容词→副词）`。
  卡片上只展示后缀部分（第一个空格前），完整说明供参考。
- `tags`：只能取下方标签体系中的值，3~6 个，**必须含一个频率标签**。
- `meaning`：中文释义，多个含义用中文分号 `；` 分隔。
- `examples`：**至少 2 个**，每个含 `en` / `zh`；偏口语/日常的词至少 1 个口语化例句（日常对话场景，可用 I'm / gonna / wanna 等缩写）。
- `derivatives`：**只放"还没有独立卡片"的衍生词**，形如
  `{ "word": "constructively", "phonetic": "/.../", "meaning": "adv. 建设性地" }`。
  一旦某个衍生词有了自己的卡片，它会通过 `family` 自动双向关联，**不要再写进 derivatives**，也不需要手写 ref。

## 新增/更新单词的标准流程（推荐直接用 word-update skill）

1. **查重 + 查词族**（只读，不需要 token）：

   ```bash
   node tools/words.js family <word>
   ```

   - `found: true` → 已存在，走 update；可用 `search` 或 `GET /api/words/:id` 拿现有内容做增量合并。
   - `found: false` 且有 `familySuggestions` → 走 add，`family` 填建议主词 id，写 `morph`。
   - `found: false` 且无建议 → 走 add，自己作为主词，`family` 填自身 id（或省略）。

2. **生成词条 JSON**：按上面字段规则写好单个单词对象，用 Write 工具存到 `/tmp/word-card-entry.json`。
   - 偏口语/日常的词，至少 1 个口语化例句；例句总数 ≥2。
3. **CLI 写入**（服务端校验 + 写 SQLite 一条龙）：

   ```bash
   WORDS_API_TOKEN=<ADMIN_TOKEN> node tools/words.js add    --file /tmp/word-card-entry.json   # 新增
   WORDS_API_TOKEN=<ADMIN_TOKEN> node tools/words.js update --file /tmp/word-card-entry.json   # 更新
   ```

   - 本地服务默认 `http://127.0.0.1:3000`；录线上词时加 `WORDS_API_URL=https://你的域名`。
   - 校验内容：必填字段、例句≥2 且含中英、标签合法且含频率、单词有音标、family 指向存在、重复单词、derivatives 引用。
   - **校验失败不写库**，按报错修正 JSON 后重跑同一命令，直到输出 `"ok": true`。
   - 警告（⚠）建议处理，例如"衍生词已有独立卡片"应从 derivatives 删除该条后重跑。
4. 批量录入时**逐词执行**第 1~3 步；不要重排/改写其他无关单词；不要手工改数据库。

## 标签体系（只能使用以下标签）

- 【频率】高频 / 中频 / 低频
- 【风格】偏口语 / 通用 / 偏书面 / 正式 / 学术
- 【表达功能】日常动作 / 情绪感受 / 态度立场 / 观点评价 / 人际交流 / 描述人物 / 描述事物 / 空间位置 / 时间顺序 / 数量程度 / 变化趋势
- 【逻辑关系】因果 / 对比 / 转折 / 递进 / 条件 / 让步 / 举例 / 总结 / 强调 / 顺序
- 【场景主题】生活 / 家庭 / 工作 / 教育 / 科技 / AI / 商业 / 经济 / 环境 / 社会 / 新闻 / 医疗健康 / 自然生物 / 交通旅行 / 文化艺术
- 【雅思用途】雅思口语 / 雅思写作 / 雅思阅读 / 雅思听力
- 【语言特征】固定搭配 / 常见介词 / 一词多义 / 易混词 / 词性变化 / 短语动词 / 习语 / 搭配词

## 本地开发与部署

```bash
npm install        # 安装依赖
npm run seed       # 首次：把 data/words/*.json 导入 SQLite
npm run dev        # 开发：tsx watch 后端(3000) + Vite 前端(5173，/api 代理到 3000)
npm run build      # 编译：tsc 后端 → dist-server/，vite 前端 → dist/
ADMIN_TOKEN=xxx PORT=3000 npm start   # 生产：node dist-server/index.js（同时托管 dist/）
```

- VPS 部署：`npm install && npm run build && npm run seed`（仅首次），然后用进程管理（pm2/systemd）运行
  `ADMIN_TOKEN=<强随机串> PORT=3000 node dist-server/index.js`，建议前置 nginx + HTTPS。
- 数据库文件 `data/words.db` 用 WAL 模式；备份 = 停写后拷贝该文件，或定期 `node tools/words.js export`。

## 其他说明

- 发音由前端调用有道免费接口（美音 `type=2`），数据中无需存储音频。
- 页面上的"同根词族"区域由前端按 `family` 字段自动聚合，无需手动维护双向关联。
- 完成后向用户简要说明：新增/更新了哪个词、归入哪个词族、校验是否通过。
