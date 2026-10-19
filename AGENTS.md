# Agent 指令

通用规则见 `AGENTS.base.md`，项目专属规则写在本文件下方。

## 项目专属规则

**项目是什么**：英闯星球的音频生产与校验工具。把台词变成 App 能用的音频：生成工作清单 → 示范音（TTS）或真人录音 → 机械校验 + ASR 内容校验 → 打包给 App。详见 `README.md`。

**边界（硬约束）**
- 只包含工具。题库、录音成品、品牌素材属于英闯星球主项目，不进本仓库
- App 只消费成品（`public/audio/**`、`wechat-miniprogram/content/audio-preview-manifest.json`）。不要把音频脚本或 `audio-preview/` 目录搬回 App
- 本仓库是开源项目（MIT）。提交前确认没有题库、录音、个人路径或凭据

**格式约束（来自 README，改动时不能破坏）**
- 成品必须是 11 kHz / 16-bit / 单声道 WAV
- 小程序分包每个 < 2 MB，总包 < 20 MB
- `work/audio/` 为空时，打包和发布必须硬失败（除非显式加 `--allow-empty`），以免清空 App 已有音频
- 打包器要同时写 `content/audio-preview-manifest.json.js`：小程序 `require()` 不能直接加载 `.json`（App 的 MP-01）
- manifest 换行统一为 LF，保证与 App 仓库逐字节一致

**常用命令**：`npm test`、`npm run worklists`、`npm run check`、`npm run verify-asr`、`npm run pack`、`npm run publish-pwa`、`npm run ui`（完整列表见 README）

**工作区文件（gitignore，不要提交）**：`voicebuilder.config.json`、`work/`、`models/`

**改动后怎么验证**
- 改 `src/` 或 `web/` 的逻辑：先跑 `npm test`
- 改打包或发布：确认上面的格式约束仍成立，再考虑是否需要真实的 App 路径来验证

**当前状态**：`docs/handoff.md`。开始工作前先读它，再读 `docs/task-log.md`

**Token 记录与会话拆分（强制）**
- 开工时把会话 ID 记在 `docs/task-log.md` 对应任务行
- 任务结束后**新开会话**跑 `node D:\LvQian\BaseCompetence\tools\token-usage.cjs <会话ID>` 取数填入 token 消耗列
- **做完一件事立即关闭本会话/窗口**，防止历史上下文重复计费
- **任务结束输出最后一句必须是**：
  > ⚠️ 任务已完成，请关闭本会话/窗口，防止历史上下文重复计费。下一任务请新开会话，阅读 `docs/handoff.md` 接续。
  这是**强制收尾动作**，不等用户提醒，不写不算完。
