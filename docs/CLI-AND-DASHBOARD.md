# 最终形态：一个命令行工具 + 一个 web 看板

> 内部 · 2026-09-22 · 范围：agentic_evaluator
> 前置：`docs/AGENT-EVALUATION-PROTOCOL.md`（协议）、`docs/HARNESS-TO-PROTOCOL-MAP.md`（行级状态）

目标是两件可交付物，**共用一个内核**：

- `agenteval` —— 可安装的命令行工具，能指向仓库外的任意任务目录。
- 看板 —— 能发起一次评测、实时看它跑、跨 run 横向比较，并且是唯一的渲染器。

本文记录：今天差在哪、目标结构、分几期、每期用什么证明没跑偏。

---

## 1. 今天的阻塞点（四条，都可验证）

**① 没有 CLI，只有 6 个 npm script。**
`run / rescore / report / dashboard / demo / parity` 各自解析参数。`src/run.ts`
的 `parseArgs` 只认 `--suite --html --yes`，没有 `--help`、没有 `--version`、
没有 `bin` 字段、没有区分退出码、没有 `--json`。任何脚本想调用它，只能去解析
人类可读的 stdout。

**② 一切锚在 `REPO_ROOT`。**
`src/paths.ts` 从模块自身位置推出仓库根，任务必须 vendored 进 `tasks/`。
`REPO_ROOT / resolveRepo / tasksDir / runsDir` 出现在 12 个文件约 50 处。
**这是「能装、能指向任意目录」唯一的真正阻塞点** —— 在它解除之前，这个工具
只能评测自己仓库里的东西。

**③ `run.ts` 1321 行，同时是参数解析 + 驱动 + 检查编排 + 两套报告写出。**
没有可编程内核：没有 `plan()`、没有 `execute(..., { onEvent })`、没有
`AbortSignal`。看板因此既无法发起一次运行，也无法订阅它的进度 —— 只能等
进程结束后去读磁盘。项目自己的文件规约是 200–400 行、上限 800，这个文件已经
超了 65%。

**④ 同一份数据有三个渲染器。**
静态 `report.html`（`report-v2.ts` / `report-workflow.ts` + charts/evidence/style）、
冻结的 `dashboard.ts` 跨 run 视图、以及 `src/demo/client` 的 React SPA。
README 里的 legacy 退役闸门，条件 (a) 正是「canonical 页面覆盖 dashboard.ts 的
跨 run 视图」—— **看板做成了，legacy 那一整层就能一次删掉**，这不是额外工作，
是同一件工作的另一面。

### 已经对的部分（不要重做）

- `src/canon/` 是干净的协议层：纯函数、有测试、不碰 IO。它就是内核该有的样子。
- `src/adapters/` 已按协议 §5 分开，候选类型是数据不是分支。
- `src/demo/client` 是 React + shadcn + Vite，看板的地基已经在那儿了。
- `fixtures/` + `tests/parity.test.ts` 用一份原版 aggregate 当 oracle 逐字段复算。
  **这是整个重构可行的原因** —— 每一期都能证明数字没动。

---

## 2. 目标结构

```
src/core/          内核：不打印、不 exit、不读 cwd
  workspace.ts     从一个路径解析出 Workspace，取代 REPO_ROOT
  plan.ts          plan(spec) -> Plan：调用数、预算、会被计费的是什么
  execute.ts       execute(plan, { signal, onEvent }) -> RunResult
  events.ts        RunEvent 联合类型：run/step/trial/judge/check/done/error
  catalog.ts       listTasks / listRuns / loadRun（从 demo/ 迁上来）
src/cli/           薄适配器：argv -> core，渲染文本或 --json，给退出码
  index.ts         bin 入口、子命令分发、--help/--version
  commands/*.ts    run plan models report dash parity init ls
src/server/        看板服务端：REST + SSE over core，预算闸门
src/web/           React 应用（由 demo/client 迁移），并静态导出成 report.html
src/canon/         不动
src/adapters/      不动
```

命令行表面：

```
agenteval run <task> [--yes] [--json] [--concurrency N] [--reuse] [--out DIR]
agenteval plan <task>                 预览：调用数、预算、会计费什么（今天的 preview）
agenteval models <task>               今天的 check-models
agenteval report <run>                重渲染
agenteval dash [--port N] [--open]    看板
agenteval parity capture|compare
agenteval init <name>                 生成 tasks/<name>/ 骨架
agenteval ls [--json]                 任务与 run 清单
```

退出码：`0` 成功 · `1` 运行失败或门槛未过 · `2` 用法错误 · `3` evaluator 错误
· `4` 超预算。**三者必须分开** —— 这和协议第 3 节是同一条原则：「检查没跑过」
和「检查跑过没发现」不能长成一样。

看板 API：

```
GET    /api/catalog
GET    /api/run/:id
POST   /api/runs              { task, ack: { calls, est_usd } }
GET    /api/runs/:id/events   SSE，直接转发 core 的 RunEvent
DELETE /api/runs/:id          取消（AbortSignal）
GET    /artifact/...
```

**预算闸门怎么做。** `POST /api/runs` 必须原样回声 `plan()` 刚刚给出的
`calls` 与 `est_usd`。对不上就 `409` —— 一个停留了半小时的页面，或者一次
spec 已被改过的提交，都无法在用户没重新看过数字的情况下发起消费。这与 CLI 的
`--yes` 语义一致，但比它更难被绕过。服务端只监听 `127.0.0.1`，同一时刻只跑一个
run，并把「由看板发起」写进 manifest 的来源字段 —— 「什么被测了」要包含
「谁按的按钮」。

---

## 3. 分期与闸门

每一期结束时：`pnpm run typecheck` 干净、全部测试绿、`tests/parity.test.ts`
在每个 fixture 上逐字段一致。任一条不满足，这一期不算完。

| 期 | 做什么 | 额外闸门 |
|---|---|---|
| **P0 基线** | 记录 oracle | ✅ 已完成：typecheck 干净，192 测试全过 |
| **P1 Workspace** | 解除 REPO_ROOT，任务目录从参数/cwd 解析 | 从仓库外的目录跑通一个 smoke task |
| **P2 内核** | 抽出 plan/execute/events；`run.ts` 收到约 150 行；所有 `console.log` 变事件 | 新增事件序列测试；`run.ts` 不再 import 任何渲染器 |
| **P3 CLI** | bin + 子命令 + --help + --json + 退出码 | 每个子命令一条 CLI 测试；README 按新表面重写 |
| **P4 服务端** | 发起 / 取消 / SSE / 预算闸门 | 用 fake agent-cli 候选从看板跑完整一次，零付费调用 |
| **P5 看板** | 跨 run 视图（覆盖 dashboard.ts）+ 实时进度 | legacy 退役闸门条件 (a) 达成 |
| **P6 统一渲染** | React 单文件静态导出为 report.html；删 legacy 整层与 report-v2 系列 | parity 绿；每个 fixture 的页面人工过一眼；report.html 离线可开 |

P1 与 P2 是解锁项，其余都依赖它们；P6 最大，但可以推迟而不阻塞最终形态。

**免费验证的载体**：`tasks/smoke-agent-cli` 与 `tasks/smoke-e2e-validation`
的候选是本地脚本，`tests/e2e-validation.test.ts` 能跑完整两臂而不付费。每一期
都用它们做端到端，不用真实模型。

---

## 4. 明确不做

鉴权与多用户、远端部署、跨机器聚合、Docker 沙箱（仍然是 deferred 状态，检查
命令以当前用户权限在本机执行）。看板是本机单人工具，不是服务。

以及一条边界：`summarize.ts` 写的是模型生成的讲解，它是注释，永远不是推荐，
不进 canonical 报告 —— 这条在统一渲染时同样成立。
