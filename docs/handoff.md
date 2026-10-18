# 交接手册

> 每次会话结束前（或对话变长时）更新本文件。新会话第一件事就是读它。
> 只写**现在的状态和下一步**，历史细节放 `docs/task-log.md`。

**最后更新：** 2026-10-18　**机器：** 公司电脑　**分支：** main（最新提交 `a166abe`）

## 当前状态

- 音标（word-grid）已按要求完成：每个词上方显示 `[ˈnoʊtəs]` 这种**方括号**音标（IPA 在上、单词在下，标点独立格）
- `src/generate-ipa.py` 修正了音标质量：重音标在**音节开头**（`ˈnoʊtɪs`，不再是 `nˈoʊtɪs`），非重读 `AH`/`ER` → `ə`/`ɚ`
- `generate-ipa.py` 已**接进流水线**：`npm run ipa`；`npm run worklists` 末尾自动跑；网页「生成工作清单」也会跑（`src/pipeline.mjs`）
- 之前积压的未提交改动已整理成 6 个提交，工作区干净（只剩 `add_word_ipa.py` 未跟踪）
- 验证：`npm test` 13 项通过；`npm run worklists` 全链通过（89 条）；Playwright(msedge + reduced motion) 确认页面渲染 `[ˈnoʊtəs]` 等、无 JS 错误

## 本次提交（main）

| commit | 内容 |
|---|---|
| `345d774` | chore：Capacitor 依赖 + 忽略规则 |
| `d600399` | feat(web)：网页逐句录音工作站（含逐词音标） |
| `37cb9ad` | feat(import)：批量导入原始录音 + 共享校验工具 |
| `0ebbb26` | feat(mobile)：离线 Capacitor 录音 App |
| `b4688af` | feat(ipa)：CMU 词典生成音标与发音提示 |
| `a166abe` | docs：README 重写 + agent 规则 + 工作流记录 |

## 下一步（按顺序）

1. 用户在浏览器里确认音标与整体 UI 满意（`npm run ui`，本地已开在 http://127.0.0.1:5180）
2. 若满意：需要的话 `git push`；否则进入下一项工作
3. 若继续美化 UI（用户曾说「界面丑」）：先和用户确认方向再动手

## 未决问题 / 需要人确认

- `capacitor.config.json` 的 appId `com.mustanglvqian.voicebuilder` 含个人标识，安卓包名发布后难改，确认是否保留
- 按用户要求，`AGENTS.base.md` 与 `docs/` 已入库（含个人路径 `D:\LvQian\BaseCompetence`）。本仓库声明为开源（MIT），若日后要转公开，这些需要重新评估
- `add_word_ipa.py`（仓库根，与 `src/generate-ipa.py` 功能重叠的一次性脚本）用户决定暂不管，仍未跟踪
- `.gitignore` 注释提到 `npm run mobile` / `npm run mobile:setup`，但 `package.json` 里没有这两个脚本（不一致，未处理）

## 工作区文件（gitignore，不要提交）

`voicebuilder.config.json`、`work/`、`models/`

## 环境备注

- 本机已装 `pronouncing`（音标生成依赖）。换机器：`pip install vosk av pronouncing`
