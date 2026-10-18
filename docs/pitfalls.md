# 踩坑登记表

这份文件是**唯一**的踩坑权威来源。其他文档里的散文规则与这里冲突时，以这里为准。

通用的坑（工具、框架、平台、Git、PowerShell 等）登记在配置包的 `experience/` 里，不在这里重复。这里只写**本项目专属**的坑。

## 硬规则

- 第一次出现：修掉并登记
- 第二次出现：必须同时做两件事，缺一不可
  1. 在本文件建（或更新）一条带稳定 ID 的记录
  2. 补一条自动检查，接进对应的 check 命令；做不到的，守卫写 `manual` 并写清人工步骤
- 没有守卫的条目不算登记
- 同一个坑第三次出现，是流程失败，不是手滑

## 守卫命令

| 命令 | 覆盖 |
|---|---|
| `npm test` | WAV 编码单测、文档专题隔离（`test/doc-topics.test.js`）、PowerShell 脚本守卫（`test/ps-scripts.test.js`）、Python 分句断言（`test/doc-to-worklist.test.py`） |

守卫列图例：`✅ 自动` 命令能拦下；`◐ 半自动` 只覆盖一部分；`manual` 只能靠人，已写明步骤。

---

## 登记表

| ID | 症状 | 根因 | 规则 | 守卫 | 来源 |
|---|---|---|---|---|---|
| WF-01 | 含中文的 `.ps1` 运行结果莫名变 `$null`、报错行号对不上文件 | PS 5.1 把**无 BOM** 的脚本按 ANSI(CP936) 解码，UTF-8 多字节注释静默破坏分词 | 含非 ASCII 字符的 `.ps1` 必须存成 **UTF-8 with BOM**；纯 ASCII 脚本无此问题 | ✅ `npm test`（`test/ps-scripts.test.js`） | 2026-10-18 `tts-worklist.ps1` |
| WF-02 | 脚本里 `$x = ReadAllText($X) \| ConvertFrom-Json` 拿到的是未解析的原始字符串或 `$null`，不是 JSON | PS 变量名**大小写不敏感**，局部 `$x` 与参数 `$X` 是同一个变量，赋值互相覆盖 | 局部变量不得与参数同名；赋值 RHS 里也不要引用被赋值的同名变量 | ✅ `npm test`（`test/ps-scripts.test.js`） | 2026-10-18 `tts-worklist.ps1` |
| DOM-01 | 文档专题的录音/示范音混进 App 成品，或 App 清单与专题清单互相串台 | 专题数据与 App 数据同目录、路由未按专题区分 | 专题只存 `work/docs/<slug>/`；`pack`/`publish` 只读 `work/audio`，任何情况下不得进入 `work/docs/**`；`/api/clips`、`/samples/`、`/recordings/` 必须按 `?topic=` 路由 | ✅ `npm test`（`test/doc-topics.test.js`） | 2026-10-18 文档专题功能 |

ID 前缀按类别分配：`WEB-` 前端、`SVR-` 服务端、`MP-` 小程序、`WF-` 工作流/环境、`DOM-` 领域逻辑。

## 怎么加一条

1. 先搜本表有没有同症状；有就更新那条，不要新建重复项
2. 分配 ID，写清「症状」——要写成你实际会看到的现象
   - 好例子：「离线没声音、无报错」
   - 坏例子：「预缓存不完整」
3. 能自动化的，写检查、接进 check，把命令填进「守卫」列
4. 不能自动化的，守卫写 `manual`，并在规则里写清人工判断步骤
5. 通用的坑不要写在这里，去配置包的 `experience/` 新建条目
