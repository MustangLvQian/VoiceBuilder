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
| T-20261018-04 | 安装依赖并启动服务测试：npm install、pip 音频后处理依赖、pip torch/torchaudio、npm test 全绿、npm run ui 启动、浏览器打开 http://127.0.0.1:5180 | done | 2026-10-18 | 依赖就绪、测试 36 项全过、服务运行中、浏览器可测试；fairseq 安装失败（Python 3.12 不兼容），RVC 需 3.10 | — | 未知 |
| T-20261018-05 | 一键收尾音频处理流程增强：新增单条音频「处理并试听」功能（播放示范→降噪统一音量→播放处理后录音），快捷键 Shift+P | done | 2026-10-18 | `src/process-audio.py` 新增 --file/--json 参数；`src/server.mjs` 新增 /api/process-clip/{id} 端点；`web/app.js` 新增 processCurrentClip() 与 Shift+P 绑定；`web/index.html` 新增「处理并试听」按钮；`npm test` 36 项全过 | — | 未知 |
| T-20261019-01 | 试用 Kokoro-82M 示范音：模型放 D:\LvQian\kokoro；`tts-kokoro.py` 新增 `--speed`；选定 af_bella、语速 0.85；生成首页 Lumi 两句到 work/lumi-kokoro/，未放入 App | done | 2026-10-19 | `src/tts-kokoro.py` 新增 `--speed`（默认 1.0，旧调用不变）；`work/` 为忽略目录，样本不入库；台词与 App `src/domain/lumiStory.ts` 一致 | — | 未知 |
| T-20261019-02 | 清晰度对比：同一句用 af_nicole / af_sarah / am_michael / am_adam 各生成一版（work/lumi-clear/），并用 vosk 离线识别 | done | 2026-10-19 | 四版识别结果均与原文一致，离线识别器分不出清晰度差别，最终由人工试听决定；`work/asr-check.py` 为临时脚本，不入库 | — | 未知 |
| T-20261019-03 | 选定 af_nicole，语速 0.85，生成首页 Lumi 两句到 work/lumi-nicole/，未放入 App | done | 2026-10-19 | 台词与 `lumiStory.ts` 一致；`work/` 忽略目录 | — | 未知 |
| T-20261019-05 | 选定 af_aoede，语速 1.0，生成首页 Lumi 两句到 work/lumi-aoede/，未放入 App。发现 work/lumi-kokoro、work/lumi-nicole、work/lumi-clear 三个目录已不存在，原因未知（非本次主动删除，work/ 不入库无法从 git 恢复） | done | 2026-10-19 | 台词与 `lumiStory.ts` 一致；模型文件与 `tts-kokoro.py --speed` 改动确认仍在 | — | 未知 |
| T-20261019-04 | 活泼女声候选：af_sky / af_jessica / af_kore / af_nova / af_aoede，语速 1.0，同一句生成到 work/lumi-cute/ | done | 2026-10-19 | 模型 voices-v1.0.bin 内共 11 个美式女声；脚本 `US_VOICES` 只列了其中 4 个，其余 7 个（alloy、aoede、jessica、kore、nova、river、sky）未列入但可用，运行时会打印警告；仅生成试听，未放入 App | — | 未知 |

## 规则

- 同一件事只开一条，不要为「重做」新建 ID；重做就把原条目改回 `todo` 并注明原因
- 生成类任务必须写明增量范围（例如「只补 `changed` 与 `missing` 条目」）
- 付费接口（TTS、大模型）调用的任务，`started` 时就要写明预计调用量
