# eval harness 与协议 v0.4 对照表

**日期：** 2026-09-15
**对照对象：** `agentic-builder/eval`（分支 `feat/model-eval-harness`，提交 18b8e1de）与 `docs/AGENT-EVALUATION-PROTOCOL (1).md`（v0.4）
**读过的文件：** README、MODEL_EVAL_HARNESS_DESIGN.md、types.ts、run.ts、llm.ts、judge.ts、score.ts、check.ts、rescore.ts、report.ts、summarize.ts、run-all.ts、producers/*、四个 suite、rubrics/prd.md。渲染层（render.ts、dashboard.ts、i18n.ts）只看导出；discover.ts、radar-html.ts 未读，与协议无关。

状态：**有** = 已满足；**部分** = 有对应机制但口径或字段不齐；**无** = 缺失。
改动量：**S** < 50 行；**M** 50–200 行；**L** > 200 行或需先设计。
本周：**●** 周五前做；**○** 本周只记录字段、不实现；**—** 推后。

## 一、协议第 3 节：运行前必须定义的

| # | 协议要求 | harness 现状 | 差距 | 改动 | 本周 |
|---|---|---|---|---|---|
| 1 | workflow step 是版本化单元，有输入输出契约 | `Suite.step` 是自由字串，无版本 | 加 step id/version 与输入集版本 | S | ● |
| 2 | 评估规格：task、goal、context、target behavior、failure modes、test cases、success criteria、required checks、judged dimensions、constraints、candidate | rubric.md（target behavior）、inputs（test cases）、check（required）、dimensions（judged）、candidates | 缺 goal、failure modes、success criteria、constraints；由 YAML loader 补 | M | ● |
| 3 | trial 结果三态：success / failure / undetermined | `RunRecord.status` 只有 ok / error；`checkPassed` 是 boolean | 加 `TaskOutcome`，undetermined 用于评估器出错 | S | ● |
| 4 | 候选资格规则（最低可靠性、必过检查阈值） | 无；tsc 结果只展示，不影响排名 | 加 eligibility 判定，不合格的不进 Pareto | M | ○ |
| 5 | 任务成功率 / 可靠性 / 首次成功率 / 自主完成率 | 只有 `okRate`（ok ÷ 全部） | 成功率按成功判定算；首次成功、自主完成对单次调用记 not_applicable | S | ● |
| 6 | 必过检查通过率，分母是已完成的检查 | `objectivePassRate` = 通过 ÷ ok 运行 | 分母改为"检查确实执行的次数"，错误运行单列 | S | ● |
| 7 | 成本六分项，估算值必须标注 | 只有每次生成的 `costUsd`；裁判与打分调用的成本**没有记录**；`llm.ts` 缺价时用私有价目表估算但**不标注**；失败调用成本记 0 | 记录裁判/打分成本；估算加 `cost_source: estimated`；失败调用保留已花成本 | M | ● |

## 二、协议第 4 节：配置

| # | 协议要求 | harness 现状 | 差距 | 改动 | 本周 |
|---|---|---|---|---|---|
| 8 | 一份版本化、人可读的配置文件，可复现 | `suites/*.json`，无版本、无 hash | YAML loader → 编译成现有 Suite；YAML 与其 hash 写进 manifest | M | ● |
| 9 | 候选 = 模型 + 供应商 + prompt + 参数 | 候选是 OpenRouter 模型 ID 字串；temperature 在 suite 顶层；供应商隐含 | 候选变对象：id、model、provider_route、generation_settings；记录里存 candidate id | M | ● |
| 10 | 试验计划：重复、seed、并发、预算、停止规则 | `trials`、`EVAL_CONCURRENCY` | seed 不传；预算与停止规则无 | S | ○ |
| 11 | 资格阈值 | 无 | 同 #4 | — | ○ |
| 12 | 运行模式：lowest-cost / fastest / highest-assurance | 无；champion = 最高胜率 | 先记录字段；选择逻辑推后 | S | ○ |
| 13 | benchmark mode 与 cache mode 分开报 | 无 | 固定写 capability-neutral / cold 进 manifest | S | ● |

## 三、协议第 5 节：契约

| # | 协议要求 | harness 现状 | 差距 | 改动 | 本周 |
|---|---|---|---|---|---|
| 14 | 完成状态六值：success、refusal、timeout、malformed、cancelled、provider error | ok / error；超时是 AbortError 文案，格式错、空回复、429 都是 error | 按错误来源分类到六值 | S | ● |
| 15 | 返回模型与供应商路线标识、TTFT、缓存信息 | `llm.ts` 不读响应里的 `provider` 字段；非流式无 TTFT；未读 `prompt_tokens_details` | 读 provider 存为 deployment_ref；TTFT 记 not_observable；缓存 token 有则记 | S | ● |
| 16 | 评估器四态：pass / fail / not_evaluated / evaluator_error，带证据与版本 | 裁判/打分失败在 `judgeAll`、`scoreAll` 里 catch 后**丢弃**，该对局消失；无评估器版本 | 失败落 `evaluator_error` 记录；评估器版本 = 裁判模型 + rubric hash + prompt 模板 hash | M | ● |
| 17 | 必过检查契约：四态、证据、实现版本 | `check.ts` 返回 passed/exitCode/output，无版本 | 包一层 EvaluationResult；版本 = tsc 版本 + scaffold hash | S | ● |
| 18 | 成功判定契约：引用每条标准，记录规则版本 | 无 | `mandatory_checks: all` 的判定函数；PRD 类无检查的步骤判 undetermined 并说明 | S | ● |
| 19 | checkpoint 契约 | 无 | 单次调用不适用 | — | — |

## 四、协议第 6 节：评估方法

| # | 协议要求 | harness 现状 | 差距 | 改动 | 本周 |
|---|---|---|---|---|---|
| 20 | 确定性检查 | tsc（codegen）、需求覆盖门（taskbreakdown，调用生产 gate） | 覆盖门依赖模型自报的 coversRequirementIds，标注为"部分自报" | — | 有 |
| 21 | 成对比较，正反交换，允许 tie | `judge.ts` 两轮一致才算胜负 | **只比每格第一个成功输出**（`representative()`），trials 不进成对；先记录该限制，多 trial 成对推后 | M | ○ |
| 22 | 有锚点的维度打分 | `score.ts` 1–5 逐维度 | 无 | — | 有 |
| 23 | 问题式检查 | 无 | 推后 | — | — |
| 24 | 人工评审与裁判校准 | 无 | 记录 `requiresHumanReview: false`，校准推后 | — | — |
| 25 | 统计比较：配对、效应量、区间、最小有意义差异、方向性标注 | 只有一段免责文字（CAVEAT） | 先做：按输入配对的胜负计数 + 输入数不足时强制标 directional；bootstrap 区间下周 | M | ● 标注 / ○ 区间 |

## 五、协议第 7 节：执行生命周期

| # | 协议要求 | harness 现状 | 差距 | 改动 | 本周 |
|---|---|---|---|---|---|
| 26 | 校验配置 | `JSON.parse` 直接用 | JSON Schema 校验 YAML | S | ● |
| 27 | 运行前预览：生成数、裁判数、花费区间 | 只打印候选数 × 输入数 | 加裁判调用数与花费估算 | S | ● |
| 28 | 冻结不可变 manifest | 无 | manifest.json：spec hash、rubric hash、prompt 模板 hash、模型 ID、裁判、并发、时间、harness 版本 | S | ● |
| 29 | 先跑对照候选 | 无 | YAML 加 `control_candidate`，报告标出 | S | ○ |
| 30 | 失败保留为结果 | 保留 error 记录 | 但成本记 0、raw 不写；保留可得部分 | S | ● |
| 31 | 按内容 hash 跳过已完成工作 | `EVAL_REUSE` 按 (candidate, input, trial) **文件名**复用，prompt 或参数变了也复用 | 复用键改为内容 hash | S | ● |
| 32 | 捕获 trace：调用、token、缓存、成本、时间 | records.json 有 token/ms/cost，无事件流；裁判调用无记录 | 最小 trace：每次 LLM 调用一条 model.request/response 事件，含裁判 | M | ● |
| 33 | 先过必过检查再判主观 | 对所有 ok 输出都判，不看 tsc | 可配置：不合格输出不进成对 | S | ○ |
| 34 | 估计不确定性 | 无 | 同 #25 | — | ○ |
| 35 | 按运行模式选择 | 无；`champion()` 取最高胜率 | 同 #12 | — | ○ |
| 36 | 端到端对照组合工作流 | 无 | 推后 | — | — |
| 37 | 输出批准的视图 | report.md/html/json、dashboard；`summarize.ts` 用 LLM 写结论和推荐 | LLM 写的推荐不是决策轨迹；保留为"AI 讲评"，不作 recommendation | — | 标注 |

## 六、协议第 12、13 节：输出与 MVP

| # | 协议要求 | harness 现状 | 差距 | 改动 | 本周 |
|---|---|---|---|---|---|
| 38 | run 目录：manifest、原始与规范化记录、检查与裁判记录含证据、每步结果表、推荐轨迹、不确定性 | raw/、records.json、report.json（判决含理由） | 缺 manifest、评估器状态、trace、决策轨迹；新增 `scores.jsonl` 规范化输出 | M | ● |
| 39 | 机器可读报告是准绳 | report.json | 是；新页面读 scores.jsonl，旧 report.html 保留对账 | S | ● |
| 40 | 首次验证 2 候选 × 10 任务 × 3 次 | codegen 3 输入、prd 2 输入 | 输入不够 10 个；本周先 3 个，标 directional | — | ○ |
| 41 | 单模型端到端对照 | 无 | 推后 | — | — |

## 七、与协议无关但影响本周的事实

- prd / trd / taskbreakdown 三个 producer 直接 import `agentic-builder/src`，拷出仓库即断。本周只用 `codegen`（自包含）和 `prompt` 两种 producer。
- `check.ts` 的 tsc 在 `eval/results/<run>/checks/` 下跑，不隔离、可联网，依赖仓库根 node_modules。本周够用，Docker 推后。
- `eval/results` 被 gitignore，本地为空，没有任何历史结果可当 golden。第一天跑出的结果要复制进 `fixtures/` 提交。
- 分支未推送远端。
- 7 月的候选 ID（deepseek-v4-pro、kimi-k3、gpt-5.3-codex 等）需先核对是否仍可路由。
- 裁判与候选同厂的偏置：codegen suite 用 Opus 判 Sonnet，同为 Anthropic。协议要求裁判跨厂商，本周换裁判或标注。

## 八、本周实施顺序

| 天 | 行号 | 内容 |
|---|---|---|
| 周二 | — | 推分支；init 仓库拷入 eval/；核对模型 ID；跑最小 codegen suite；结果进 fixtures/ |
| 周三 | 8、9、26、28、13 | YAML loader、候选对象、schema 校验、manifest |
| 周三 | 3、14、15、16、17、18 | 状态六值、TaskOutcome、provider、评估器四态、成功判定 |
| 周四 | 7、30、31、32、38 | 裁判成本、失败成本、内容 hash、最小 trace、scores.jsonl |
| 周四 | 39 | 读 scores.jsonl 的页面 |
| 周五 | 5、6、25、27 | 率的口径、directional 标注、运行预览；GAPS.md；演示 |

## 九、GAPS.md 初始条目（适配器填 not_observable）

TTFT；缓存读写；deployment 的 region 与 tier；每条评估器的耗时（裁判有 ms，可补）；人工介入（not_applicable）；checkpoint；工具调用（本周 producer 无工具）。

## 十、实施状态（2026-09-16 更新）

仓库 `agentic_evaluator` 已建立，harness 原样导入为第一次提交，之后逐步改造。本周 ● 行的完成情况：

| 已完成 | 说明 |
|---|---|
| 1、2、8、9、13、26 | `specs/*.yaml` 经 JSON Schema 与语义检查编译为 Suite；候选为对象，记录里存 candidate id；manifest 记 benchmark / cache 模式 |
| 3、14、18 | RunRecord 有六值 completion_state 与 TaskOutcome；`canon/success.ts` 实现成功判定契约，prd 步骤全部 undetermined |
| 15 | `llm.ts` 读 OpenRouter 的 provider 字段，deployment_ref 形如 `openrouter/claude-platform-on-aws` |
| 16、17 | 裁判/打分失败落 evaluator_error 行并记成本；tsc 检查四态带版本 |
| 7、30 | ledger.json 六分项；成本来源标注；失败调用保留已计费用量 |
| 31 | EVAL_REUSE 按 trialHash 复用 |
| 32 | trace.jsonl 每次 LLM 调用一条，含裁判与打分；不记 prompt 正文 |
| 5、6、25 | summary.json 每个率带分子分母；directionality 标注 |
| 27 | 运行前预览打印生成数、裁判数、打分数；YAML spec 需 `--yes` 才执行 |
| 38、39 | scores.jsonl / evaluations.jsonl / report.html（canonical）与 legacy 输出并存 |
| 对账 | `tests/parity.test.ts` 用 `tests/legacy-aggregate.ts`（导入提交的原版 aggregate）复算，对 fixtures 逐字段一致 |

未做（本周 ○ 或 —）：#4/#11 资格门槛影响排名、#10 seed 与预算强制、#12/#35 运行模式选择、#21 多 trial 进成对、#23/#24、#29 对照候选比较（只标记）、#33、#34 区间估计、#36、#40 十个输入、#41。预览的花费估算（#27 的一半）未做，目前只打印调用数。

从真实运行中发现并修掉的问题：读取响应体阶段的 AbortError 绕过了 LlmError，被记成 malformed、ms=0、无 trace 事件；宿主机挂起（trace 里规律的 16 分钟空档）让所有超时与耗时失真，现在 summary.json 有 integrity 字段、GAPS.md 会警告。
