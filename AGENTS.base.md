# 基础规则（所有项目通用）

> 托管文件，由配置包 `D:\LvQian\BaseCompetence` 维护。项目专属规则写在项目的 `AGENTS.md`。
> 细节按需读取：`D:\LvQian\BaseCompetence\rules\` 下的文件。**只在用到时才读，不要一开始全部读。**

## 每次会话

1. 项目根目录有 `docs/handoff.md` 就读它。没有就跳过，不要创建
2. 需求不清楚，用提问工具问清楚再动手。不要靠猜
3. 遇到报错或不熟悉的工具，先搜经验库，再试错：
   `node "D:\LvQian\BaseCompetence\tools\find-experience.cjs" <关键词>`
4. 需要选 skill 时，读 `D:\LvQian\BaseCompetence\rules\routing.md`
5. 只在必要时问用户：需求分歧、登录、管理员权限、SSH 公钥、交接里列出的待确认事项。路径和项目信息自己去找

## 每次结束

- 更新 `docs/handoff.md`（如果存在）：当前状态、下一步、待确认事项
- 任务日志 `docs/task-log.md` 的「token 消耗」列：看得到数字就填，看不到写「未知」，不要编造

## 始终遵守

- 守卫由 git 钩子执行。违规时修正，**不要用 `--no-verify`**
- `git pull --rebase`；禁止强制推送 main
- 不删除或覆盖用户未提交的改动

## 按需读取

- `rules/routing.md`：按需求选 skill 的路由表
- `rules/detail.md`：token 节省、验证方法、经验同步、守卫说明
