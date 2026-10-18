# 交接手册

> 每次会话结束前（或对话变长时）更新本文件。新会话第一件事就是读它。
> 只写**现在的状态和下一步**，历史细节放 `docs/task-log.md`。

**最后更新：** 2026-10-18　**机器：** 公司电脑　**分支：** main（最新提交 `24024c8`，领先 `origin/main` 8 个提交，未推送）

---

## 文档专题录音：已实现并验证（T-20261018-03）

上传英文文档（PDF / docx / txt / md）→ 自动分句 → 生成音标与 TTS 示范音 → 网页里切换到该专题逐句录音。**独立练习，不进 App。**

### 交付的代码

| 文件 | 作用 |
|---|---|
| `src/doc-to-worklist.py` | 文档 → 归一化空白 → 英文分句 → `work/docs/<slug>/worklist.json` |
| `src/tts-worklist.ps1` | 给**任意** worklist 合成 11 kHz/16-bit/mono 示范音（SAPI） |
| `src/topics.mjs` | 专题目录解析与路径穿越防护（`TOPIC_SLUG` 正则） |
| `src/server.mjs` | `POST /api/docs`（上传→解析→音标→TTS）、`GET /api/topics`、`/api/clips?session=`、`/samples?topic=`、`/recordings?topic=` 及录音写入按专题路由 |
| `web/index.html` / `web/app.js` | 「清单」下拉切换 App 题库 / 各专题 + 文档上传区 |
| `test/doc-to-worklist.test.py` | 分句断言 15 项 |
| `test/doc-topics.test.js` | 专题隔离 + 路径穿越 5 项 |
| `test/ps-scripts.test.js` | PS 脚本守卫（BOM、参数/变量撞名）3 项 |

### 目录布局

`work/docs/<slug>/{doc.<ext>, worklist.json, manifest.json, samples/, audio/}`。专题录音**只**写 `audio/`，打包/发布只读 `work/audio/`，互不相扰（守卫 `test/doc-topics.test.js`）。

### 已验证（2026-10-18）

- `npm test`：JS 21 项 + Python 15 项，全过
- 服务端到端：`POST /api/docs?name=test-article.txt` → 12 句 / 171 词；音标 12 条；TTS 12 个 WAV 全部 11025/16/mono；`PUT /api/recordings/doc-test-article-0001?topic=test-article` 落到 `work/docs/test-article/audio/`，`DELETE` 正常
- Playwright（msedge headless）：切到专题 → 12 条、逐词音标渲染、`→` 翻到第 2 条、切回 App 清单 89 条，**0 JS 报错**

### 本次踩的坑（已登记 `docs/pitfalls.md`）

- WF-01：`.ps1` 含中文必须 **UTF-8 with BOM**，PS 5.1 对无 BOM 文件按 CP936 解码会静默破坏
- WF-02：PS 变量名大小写不敏感，局部 `$worklist` 与参数 `$Worklist` 撞名，赋值拿到未解析字符串
- DOM-01：专题数据必须与 App 的 `work/audio`、`work/samples` 隔离

### 下一步

1. 提交（本文件、`task-log`、README、pitfalls、代码与测试分成功能/文档/配置三块提交）
2. 推送前需用户确认：本仓库声明开源（MIT），专题功能本身不含题库内容，可安全推送

---

## 当前状态（上一轮已完成）

- 音标（word-grid）已完成：每个词上方显示 `[ˈnoʊtəs]` 这种**方括号**音标（IPA 在上、单词在下，标点独立格）
- `src/generate-ipa.py` 修正音标质量：重音标在**音节开头**（`ˈnoʊtɪs`，不再 `nˈoʊtɪs`），非重读 `AH`/`ER` → `ə`/`ɚ`
- `generate-ipa.py` 已**接进流水线**：`npm run ipa`；`npm run worklists` 末尾自动跑；网页「生成工作清单」也会跑（`src/pipeline.mjs`）
- 之前积压的未提交改动已整理成 8 个提交（见下），工作区干净（只剩未跟踪 `add_word_ipa.py`）
- 验证：`npm test` 13 项通过；`npm run worklists` 全链通过（89 条）；Playwright(msedge) 确认渲染与无 JS 错误

### 本次提交（main，未推送）

| commit | 内容 |
|---|---|
| `345d774` | chore：Capacitor 依赖 + 忽略规则 |
| `d600399` | feat(web)：网页逐句录音工作站（含逐词音标） |
| `37cb9ad` | feat(import)：批量导入原始录音 + 共享校验工具 |
| `0ebbb26` | feat(mobile)：离线 Capacitor 录音 App |
| `b4688af` | feat(ipa)：CMU 词典生成音标与发音提示 |
| `a166abe` | docs：README 重写 + agent 规则 + 工作流记录 |
| `e0a2f87` | docs：更新交接与任务日志 |
| `24024c8` | fix(web)：恢复 App 路径占位符（用户要求） |

---

## 未决问题 / 需要人确认（历史遗留）

- `capacitor.config.json` 的 appId `com.mustanglvqian.voicebuilder` 含个人标识，安卓包名发布后难改
- 按用户要求，`AGENTS.base.md` 与 `docs/` 已入库（含个人路径 `D:\LvQian\BaseCompetence`）。本仓库声明为开源（MIT），若日后要转公开需重新评估
- `add_word_ipa.py`（仓库根，与 `src/generate-ipa.py` 重叠的一次性脚本）用户决定暂不管，仍未跟踪
- `.gitignore` 注释提到 `npm run mobile` / `npm run mobile:setup`，但 `package.json` 没有这两个脚本
- 观察：约 10:25 有一次同步动作同时写了 `VoiceBuilder\AGENTS.base.md` 与 `YingChuangXingQiu\AGENTS.base.md`、`docs\handoff-base-competence.md`（非本会话所为），疑似 BaseCompetence 的文件监听/钩子

## 工作区文件（gitignore，不要提交）

`voicebuilder.config.json`、`work/`、`models/`

## 环境备注

- 本机 5180 上可能跑着一个 `node src/server.mjs`；**改 server 后要重启它**（本次验证用的就是新起的实例）
- 本机已装 `pronouncing`、`python-docx`、`nltk`、`markdown`、`pypdf`（文档专题需要）
- 换机器：`pip install vosk av pronouncing python-docx pypdf`
- Playwright 用系统 Edge（`channel="msedge"`），不要 `playwright install chromium`
