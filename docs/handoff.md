# 交接手册

> 每次会话结束前（或对话变长时）更新本文件。新会话第一件事就是读它。
> 只写**现在的状态和下一步**，历史细节放 `docs/task-log.md`。

⚠️ **任务结束时必须关闭本会话/窗口。** 旧会话历史每次交互都重复计费，跨会话上下文靠 `docs/handoff.md` 传递，不靠留着旧会话。
⚠️ **下一个 Agent 必须：更新本 handoff.md → 提醒用户关闭窗口。** 这是强制规则，见 `AGENTS.base.md` 与 `docs/handoff-base-competence.md`。

**最后更新：** 2026-10-18　**机器：** 公司电脑　**分支：** main（最新提交 `24024c8`，领先 `origin/main` 8 个提交，未推送）

## 当前状态

- ✅ 依赖已安装：`npm install`、`pip install noisereduce pydub scipy numpy soundfile pyloudnorm resampy`、`pip install torch torchaudio`、`pip install kokoro-onnx misaki[en]`
- ✅ 测试全绿：`npm test` — JS 21 项 + Python 15 项全部通过
- ✅ 服务已重启：`npm run ui` 运行在 `http://127.0.0.1:5180`（后台 shell ID: sh_14e4894de001gnDMFzTe5K7O92，**新进程，含最新修复**）
- ✅ 浏览器可打开：用户可直接测试录音工作站
- ✅ **RVC 美式口音转换已移除**（授权风险：fairseq GPL、模型权重不明），`process-audio.py` 仅保留降噪 + 响度归一化
- ✅ **新增 Kokoro TTS 示范音生成**（`src/tts-kokoro.py`，Apache-2.0，商用安全，自然美式发音，8 种音色可选）
- ✅ `npm run tts` / `pipeline.mjs` / 文档专题上传均已切换到 Kokoro TTS
- ✅ 新增单条音频处理并试听功能：处理音频（降噪+统一音量） → 播放处理后的录音，快捷键 Shift+P
- ✅ **修复音频缓存问题**：处理后播放、点击「播放我的录音」、按 P 键试听均加 cache-busting
- ✅ **修复音频处理 "not found" 报错**：`process-audio.py` 正确处理服务端传入的绝对路径；`/api/process-clip/` 单条处理接口正常工作
- ✅ **新增系统提示音到录音清单**：`excellent.wav`、`bingo.wav`、`good-try.wav`、`thank-you-practicing.wav`（App 反馈音效，需真人录制为 11kHz/16bit/mono WAV）
- ✅ **已生成全部 93 条示范音（Windows SAPI，11kHz/16bit/mono WAV）**：`src/generate-audio-sapi.ps1` → `work/samples/`
- ✅ **已打包交付给 Yingchuang 项目**：
  - 小程序分包：8 个 subpackage（每个 <2MB），`wechat-miniprogram/subpackages/audio-preview-01..08/`
  - 小程序清单：`wechat-miniprogram/content/audio-preview-manifest.json` (+ `.json.js`)
  - PWA 发布：`public/audio/{listening|lumi|system-prompts}/` + `public/audio/manifest.json`
  - 系统提示音 4 条已按 App 期望路径放入 `public/audio/system-prompts/*.wav`
- 已完成但未推送：新增 `src/tts-kokoro.py`、`src/process-audio.py`（已移除 RVC）、`src/fetch-rvc-model.ps1`（已标记弃用）、`src/generate-audio-sapi.ps1`，修改 `pipeline.mjs`、`server.mjs`、`generate-audio.ps1`、`tts-worklist.ps1`、`build-recording-worklist.mjs`、`publish-pwa.mjs`、`README.md`、`docs/handoff.md`、`web/app.js`

## 下一步（按顺序）

1. 用户在浏览器验证功能无误（**需刷新页面以连接新服务进程**）后，提交：代码、README、handoff、task-log 分功能/文档/配置三块提交
2. 用户确认推送：本仓库声明开源（MIT），专题功能不含题库内容，可安全推送
3. **Yingchuang 项目需更新 App 代码**：`src/App.tsx` 的 `SYSTEM_PROMPT_AUDIO` 与 `public/sw.js` 预缓存路径，将 `.mp3` 改为 `.wav`（或同时保留两套）
4. 在录音工作站录制 4 条系统提示音真人版（Excellent!、Bingo!、Good try! Let's try again.、Thank you for practicing with me today!），它们现在排在清单最前面
5. 继续录制其余 83 条缺失音频（`npm run check -- --list work/recording-worklist.json` 可查看完整缺失列表）
6. 验证 `npm run tts` 生成的示范音质量（自然度、美式发音准确性）——系统提示音的示范音待网络恢复后补齐
7. （可选）如需 Whisper + Kokoro 重合成管线（ASR 转写 → TTS 重合成），另开会话实施

## 未决问题 / 需要人确认

- `capacitor.config.json` 的 appId 含个人标识，安卓包名发布后难改
- `AGENTS.base.md` 与 `docs/` 已入库（含个人路径 `D:\LvQian\BaseCompetence`），若日后转公开需重新评估
- `add_word_ipa.py` 未跟踪（用户决定暂不管）
- `.gitignore` 注释提到 `npm run mobile` 但 `package.json` 无此脚本

## 本次不要做的事

- 不要用 `--no-verify` 绕过守卫
- 不要强制推送 main
- 不要把个人路径/题库/录音成品提交进仓库
- 不要恢复 RVC 相关代码（授权风险未解决）

## 换机器 / 新会话的启动步骤

```powershell
git pull --rebase
npm install
# 然后读 docs/task-log.md 确认哪些任务已 done
# 音频后处理依赖：
pip install noisereduce pydub scipy numpy soundfile pyloudnorm resampy
# TTS 示范音生成（Kokoro，商用安全）：
pip install kokoro-onnx misaki[en]
# ASR 模型：
npm run model
```