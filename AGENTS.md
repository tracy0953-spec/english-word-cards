# AGENTS.md — 单词卡片数据维护指南

本项目是纯静态移动端 H5 单词卡片应用（Vue 3 + Vant 4，CDN 引入，无需构建）。
Agent 的职责是**维护单词数据**，一般不需要改动页面代码。

> 本项目配有两个专用 skill，处理单词任务时应优先使用：
> - **word-family-lookup**：查同根/同词族/相近结构的词
> - **word-update**：新增或更新单词的标准流程

## 项目结构

- `data/words/<单词id>.json` — **数据源，一词一个文件**（Agent 不直接手工编辑，一律走 CLI 写入）
- `data/bundle.js` — 脚本自动生成，H5 页面通过 `<script>` 直接读取；**禁止手动编辑**
- `data/index.json` — 脚本自动生成的精简索引（id/word/pos/family/tags/morph），供快速通览；**禁止手动编辑**
- `tools/words.js` — **数据 CLI：查询 / 写入 / 校验 / 打包的唯一入口**
- `index.html` / `css/style.css` / `js/app.js` — 页面代码，除非用户要求改功能，否则不要动

## CLI 命令（node tools/words.js ...）

| 命令 | 作用 |
|---|---|
| `family <word>` | 查重 + 查同根词族；未录入时按后缀（-tion/-ly/-ness 等）给出词族主词建议 |
| `search <keyword>` | 模糊搜索单词 / 中文释义 / 标签 |
| `index` | 输出精简索引（省 token 通览全部词） |
| `add --file <path>` | 新增单词：校验 → 原子写入 `data/words/<id>.json` → 自动重建 bundle/index |
| `update --file <path>` | 更新已有单词（规则同上，词必须已存在） |
| `validate` | 只校验不写产物 |
| `build` | 全量校验并重新生成 `data/bundle.js` 与 `data/index.json` |

- add/update 的输入是单个单词 JSON 对象，通过 `--file` 传入（可先写到 `/tmp/word-card-entry.json`），也支持 stdin。
- **校验不过不会写任何文件**；错误会逐条打印，修正后重跑同一命令即可。
- add/update 成功后会自动 build，无需再手动跑。

## 数据结构（每个单词一个 JSON 文件）

文件名 = `id`，例如 `data/words/construct.json`：

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

- `id`：单词/短语小写，空格转连字符（`look forward to` → `look-forward-to`），与文件名一致。
- `word`：单词或短语原样（短语含空格）。
- `phonetic`：**美音**音标；短语（`pos: "phr."` 或含空格）省略此字段。
- `pos`：词性，如 `n.` `v.` `adj.` `adv.` `phr.`。
- `family`：**词族主词 id**。同根词共享同一个值，取最基础形态（通常是动词/形容词/名词原形）。
  如 `construct / construction / constructive / constructively` 的 `family` 都是 `"construct"`；
  单词自身就是主词时 `family` 等于自己的 `id`。**必填。**
- `morph`：本词相对主词的构词说明，主词省略。如 `-ly 副词后缀（形容词→副词）`、`-tion 名词后缀（动词→名词，y 变 i 加 on）`。
  卡片上只展示后缀部分（第一个空格前），完整说明供参考。
- `tags`：只能取下方标签体系中的值，3~6 个，**必须含一个频率标签**。
- `meaning`：中文释义，多个含义用中文分号 `；` 分隔。
- `examples`：**至少 2 个**，每个含 `en` / `zh`；偏口语/日常的词至少 1 个口语化例句（日常对话场景，可用 I'm / gonna / wanna 等缩写）。
- `derivatives`：**只放"还没有独立卡片"的衍生词**，形如
  `{ "word": "constructively", "phonetic": "/.../", "meaning": "adv. 建设性地" }`。
  一旦某个衍生词有了自己的 JSON 文件，它会通过 `family` 自动双向关联，**不要再写进 derivatives**，也不需要手写 ref。

## 新增/更新单词的标准流程（推荐直接用 word-update skill）

1. **查重 + 查词族**（只读）：

   ```bash
   node tools/words.js family <word>
   ```

   - `found: true` → 已存在，走 update；先读 `data/words/<id>.json` 拿现有内容做增量合并。
   - `found: false` 且有 `familySuggestions` → 走 add，`family` 填建议主词 id，写 `morph`。
   - `found: false` 且无建议 → 走 add，自己作为主词，`family` 填自身 id。

2. **生成词条 JSON**：按上面字段规则写好单个单词对象，用 Write 工具存到 `/tmp/word-card-entry.json`（不要直接写进 `data/words/`）。
   - 偏口语/日常的词，至少 1 个口语化例句；例句总数 ≥2。
3. **脚本写入**（校验 + 原子写 + 自动重建 bundle/index 一条龙）：

   ```bash
   node tools/words.js add    --file /tmp/word-card-entry.json   # 新增
   node tools/words.js update --file /tmp/word-card-entry.json   # 更新
   ```

   - 校验内容：id/文件名、必填字段、例句≥2 且含中英、标签合法且含频率、单词有音标、family 指向存在、重复单词、derivatives 引用。
   - **校验失败不落盘任何文件**，按报错修正 JSON 后重跑同一命令，直到输出 `"ok": true`。
   - 警告（⚠）建议处理，例如"衍生词已有独立卡片"应从 derivatives 删除该条后重跑。
4. 批量录入时**逐词执行**第 1~3 步；不要重排/改写其他无关单词文件；不要手动编辑 `data/bundle.js` / `data/index.json`。

## 标签体系（只能使用以下标签）

- 【频率】高频 / 中频 / 低频
- 【风格】偏口语 / 通用 / 偏书面 / 正式 / 学术
- 【表达功能】日常动作 / 情绪感受 / 态度立场 / 观点评价 / 人际交流 / 描述人物 / 描述事物 / 空间位置 / 时间顺序 / 数量程度 / 变化趋势
- 【逻辑关系】因果 / 对比 / 转折 / 递进 / 条件 / 让步 / 举例 / 总结 / 强调 / 顺序
- 【场景主题】生活 / 家庭 / 工作 / 教育 / 科技 / AI / 商业 / 经济 / 环境 / 社会 / 新闻 / 医疗健康 / 自然生物 / 交通旅行 / 文化艺术
- 【雅思用途】雅思口语 / 雅思写作 / 雅思阅读 / 雅思听力
- 【语言特征】固定搭配 / 常见介词 / 一词多义 / 易混词 / 词性变化 / 短语动词 / 习语 / 搭配词

## 其他说明

- 发音由前端调用有道免费接口（美音 `type=2`），数据中无需存储音频。
- 页面上的"同根词族"区域由前端按 `family` 字段自动聚合，无需手动维护双向关联。
- 完成后向用户简要说明：新增/更新了哪个词、归入哪个词族、build 校验是否通过。
