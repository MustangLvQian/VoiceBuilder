# 任务日志

用来防止重复执行。开工前先搜本文件：ID 已是 `done` 的任务不要重跑。

## 状态说明

| 状态 | 含义 |
|---|---|
| `todo` | 还没开始 |
| `started` | 已开始，结束前若对话断开，下个会话看到它要先核对产物再决定续跑或重来 |
| `done` | 已完成，写清 commit 和产物位置 |
| `failed` | 失败，写清原因和是否可重试 |

## 记录格式

ID 用 `T-YYYYMMDD-序号`。每条一行，结果要可核对（commit、文件路径、数量）。

| ID | 任务 | 状态 | 日期 | 结果 / 产物 | commit | token 消耗 |
|---|---|---|---|---|---|---|
| T-20261018-01 | word-grid 音标加 `[]`；修正重音位置与非重读元音；`generate-ipa.py` 接入流水线 | done | 2026-10-18 | `web/app.js`、`src/generate-ipa.py`、`package.json`、`src/pipeline.mjs`；`npm test` 13 过、`npm run worklists` 89 条 | `d600399` `b4688af` | 未知 |
| T-20261018-02 | 存量未提交改动按功能拆 6 次提交 | done | 2026-10-18 | 工作区干净，仅剩未跟踪 `add_word_ipa.py` | `345d774`…`a166abe` | 未知 |
| T-20261018-03 | 文档专题录音：网页上传 PDF/docx/txt/md → 分句 → TTS 示范音 → 界面切换清单后逐句录音（独立练习，不进 App） | done | 2026-10-18 | 7 项已确认：超30词兜底拆分/同名覆盖/专题名用文件名/自动生成音标/上限16MiB/同意装pypdf/纯脚本断言；TTS 用本机 SAPI（免费，调用量=条数）；`src/doc-to-worklist.py` `src/tts-worklist.ps1` `src/topics.mjs` + server/web 改造；`npm test` JS 21 + Python 15 全过；服务端到端与 Playwright(msedge) 验证通过，0 JS 报错 | `10be4fd` | 未知 |

## 规则

- 同一件事只开一条，不要为「重做」新建 ID；重做就把原条目改回 `todo` 并注明原因
- 生成类任务必须写明增量范围（例如「只补 `changed` 与 `missing` 条目」）
- 付费接口（TTS、大模型）调用的任务，`started` 时就要写明预计调用量
