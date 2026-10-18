# 交接手册

> 每次会话结束前（或对话变长时）更新本文件。新会话第一件事就是读它。
> 只写**现在的状态和下一步**，历史细节放 `docs/task-log.md`。

**最后更新：** 2026-10-18　**机器：** 公司电脑　**分支：** main（最新提交 `b90fec0`）

## 当前状态

- 已完成：BaseCompetence 配置接入（托管文件、pre-commit/pre-push 守卫钩子、skill 路由检查全部通过）
- 已完成：录音工作站 UI 改版 —— 音标按词显示（IPA 在上、单词在下，标点独立格），数据字段 `wordIpa` 已生成并由 server 透传。改动涉及 `src/generate-ipa.py`、`src/server.mjs`、`web/app.js`、`web/index.html`、`work/recording-worklist.json`
- 验证：`npm test` 13 项通过；Playwright(msedge+reduced_motion) 确认 word-grid 渲染正确、无 JS 错误
- 未提交：上述全部改动 + 接入前就存在的 `src/`、`web/`、`mobile/` 等改动

## 下一步（按顺序）

1. 用户确认接入前就存在的未提交改动是否保留、提交到哪个分支（见「未决问题」）
2. 用户确认 word-grid 新 UI 满意后，提交本次音标改动（只暂存相关文件，不要 `git add -A`）
3. 检查 `.gitignore` 覆盖 `voicebuilder.config.json`、`work/`、`models/`
4. 如需继续美化 UI（用户曾说「界面丑」，word-grid 已是第一轮改进），和用户确认方向再动手

## 未决问题 / 需要人确认

- 接入前的大量未提交改动：是否属于一次未完成的工作？提交前需要用户过目
- `mobile/`、`android/`、`capacitor.config.json`、`package-lock.json` 未跟踪，是否纳入仓库？
- `work/recording-worklist.json` 是工作区文件（gitignore），但里面新增了 `wordIpa` 字段——重新生成即可，无需提交

## 本次不要做的事

- 不要把音频脚本或 `audio-preview/` 目录放回英闯星球主项目
- 不要提交 `work/`、`models/`、`voicebuilder.config.json`
- 不要用 `--no-verify` 绕过守卫

## 换机器 / 新会话的启动步骤

```powershell
git pull --rebase
npm install
pip install vosk av
npm run model
node tools/check-skills.cjs --file AGENTS.md
# 然后读 docs/task-log.md 确认哪些任务已 done
```
