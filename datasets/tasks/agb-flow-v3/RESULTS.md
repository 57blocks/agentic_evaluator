# agb-flow v3 结果（进行中，2026-11-13）

agb `0a8c4ee7`，judge `openai/gpt-6.1-sol`（v2 重判 128 对，与 grok 只有 2 对相反），
每步 2–3 个输入、每组 1 次，结论都是方向性的。花费是按 token 折算的订阅用量。

合并的规划结果：`runs/agb-flow-v3-combined-2026-11-13T12-17-21-516Z`
（spec 来自 `09-04-37`，其余来自 `10-23-03`；第一趟 architecture 撞上 5 小时额度，已被第二趟覆盖）。

## 规划四步

| 步骤 | 检查 | judge 胜场（每对正反各判一次，不一致记平） | 花费 | 推荐 |
|---|---|---|---|---|
| spec（2 输入） | 全过 | opus 1/4 · Fable 1/4 · sonnet 0/4 | opus $10.3 · Fable $17.8 · sonnet $2.7 | opus（与 Fable 打平） |
| architecture（3） | 全过 | Fable 4/6 · opus 3/6 · sonnet 0/6 | Fable $20.6 · opus $11.0 · sonnet $3.2 | Fable |
| task-breakdown（3） | 全过 | opus 1/3 · sonnet 0/3（2 平） | opus $15.9 · sonnet $2.9 | opus |
| test-design（3） | 全过 | opus 3/3 · sonnet 0/3 | opus $9.7 · sonnet $1.6 | opus |

所有模型都过了 agb 的门禁，差别只在 judge。sonnet 在四步里一场没赢，但花费约是 opus 的 1/5、时间约 1/3。

## 整项目构建

### demo-todo（`agb-flow-v3-build/runs/agb-flow-v3-build-2026-11-13T12-17-33-932Z`）

| 组 | 留出测试 | judge 胜场 | 花费 | 时长 |
|---|---|---|---|---|
| opus + agb | 23/24（AT-012 挂：进行中→完成的卡片移动） | 3/3 | $19.3 | 4.3 h（含约 2.5 h 等额度刷新） |
| sonnet + agb | 24/24 | 2/3 | $3.0 | 46 min |
| opus 裸 `claude -p` | 24/24 | 1/3 | $1.8 | 9 min |
| sonnet 裸 `claude -p` | 24/24 | 0/3 | $0.5 | 5 min |

- demo-todo 太小，四组留出测试几乎都满分，拉不开；差别只在 judge：agb 组都赢裸组，理由集中在
  并发/缓存一致性的处理和对应的回归测试。
- 裸组读到了同样的规划产物（`.ab/prd.json`、`design.json`、`test-plan.json`），但没跑 agb 的编排与审计。
- agb 的代价：同模型下花费约 6–10 倍、时长约 10 倍。
- opus 那 1 个失败未复查是偶发还是真缺陷。

### invoice（`agb-flow-v3-build/runs/agb-flow-v3-build-2026-11-13T17-44-16-383Z`）

run 目录里的结论（opus 被门禁挡、推荐 sonnet、sonnet 28/44）**作废**，是评分机环境问题造成的：
本机 `chessicle_app-postgres-1` 占着 5432，两份构建的数据库都没起来；构建自己的 `playwright install`
还把评分用的浏览器清掉了。修好检查后**手工重评**（不经 agenteval）：

| 组 | 留出 API | 留出 UI | judge | 花费 | 时长 |
|---|---|---|---|---|---|
| opus + agb | 29/29 | 2/15（不可比，见下） | 胜 1/1 | $71.1 | 6.3 h |
| sonnet + agb | 29/29 | 12/15 | 0/1 | $15.4 | 4.8 h |

- API 29 条只是“公开端点 + 未登录被拒”的探针，两边都满分，分不开。
- UI 测试照参考实现写，绑定了它的两处细节，PRD 都没规定：
  门户交接的 URL 参数名（参考 `portalToken`，opus 用 `portal_token`；DESIGN 把交接形态列为外部事实 Q-069）、
  以及页面会发哪些请求（opus 的侧栏额外请求 `/api/invoices/status-counts`，没被 mock，真后端对假令牌回 401，
  opus 按契约当会话失效）。两处都补上后 opus 的客户列表页正常渲染。所以 **opus 的 UI 分不能算它的错**，
  这套 UI 测试只对“请求方式接近参考实现”的实现有效，需要重做（见待办）。
- sonnet 挂的 3 条：AT-017（应付总额 < 1 时的表单报错文案缺失）、AT-044、AT-049（结算页的发票行/提交流程）。
- judge 选 opus：结算恢复在外部调用前先落请求标识，sonnet 的未知 payout 记录可能丢、错误被吞；
  sonnet 的后端回归测试更全。

### 检查脚本这次修了什么（`checks/build-tests.mjs`）

- compose 发布的宿主机端口一律换成空闲端口，并同步改 `.env` 里的 URL；
- `.env` 总是从 `.env.example` 重建（构建者遗留的 `.env` 带着它自己的端口）；
- `db:fresh` 拒绝时退到 `db:migrate`；
- 跑 UI 前确保评分用的 Playwright 浏览器在；
- 探测网页时跟随跳转（站点挂在 `/apps/invoice/` 下）；开跑前已被占用的端口不参与探测；
- UI 失败把 Playwright 报错写进结果。

重新校准：invoice 参考实现 44/44，demo-todo 参考实现 24/24，空项目判失败。demo-todo 四组是旧检查评的（无 compose，不受影响）。

### 用检查分数重评（2026-11-16，agenteval `feat/check-score`）

命令检查现在可以报分（`score` 0–1），highest-assurance 在通过率打平时先比分数、再看 judge。
合并报告：`runs/agb-flow-v3-all-combined-2026-11-16T03-02-42-750Z`（构建来自 `agb-flow-v3-build-2026-11-16T02-51-48-044Z`）。

- build-demo-todo：opus 96%（AT-012 挂，裁定为 opus 的问题：给前进和后退两个按钮用了契约里同一个 testid），
  其余三组 100%；三组再由 judge 选 → **sonnet + agb**。
- build-invoice：分数只计 API（`references/build/_heldout/invoice/scoring.json`，UI 未裁定），两组都 100%，
  judge 选 → **opus**。UI 通过数仍在 evidence 里（opus 2/15、sonnet 12/15）。

### 按 agb 阶段合成（2026-11-16）

`runs/agb-flow-v3-all-combined-2026-11-16T06-03-08-431Z`：spec / architecture / task-breakdown / test-design / code 五步
（交付没测）。code = 两个项目合一步（`agb-flow-v3-build/code.yaml`，run `agb-flow-v3-code-2026-11-16T05-56-11-141Z`）：
sonnet 分数 100%、opus 98%（只差 demo-todo 的 AT-012）→ 推荐 **sonnet**；judge 两个项目都偏 opus（2/2）。
裸 `claude -p` 对照不是 agb 阶段，留在 `build-demo-todo` 那次运行里。

## 结论（方向性，每组一次）

- 规划四步：opus（architecture 可用 Fable）；sonnet 一场没赢但便宜约 5 倍。
- 整项目构建：demo-todo 太小分不开；invoice 上 judge 偏 opus，留出 UI 只有 sonnet 能可靠计分（12/15），
  opus 花费约 4.6 倍。用 agb 比裸 `claude -p` 在 judge 上全胜，代价约 6–10 倍花费。

## 待办

1. invoice UI 留出测试改成不依赖参考实现的请求方式（或换成带真实会话的黑盒测试），再重评两组。
2. agenteval 核心：命令检查只有通过/不通过、evidence 截断到 600 字；同一任务并发跑会破坏 references 隐藏；
   combine 不带 trial 文件；CLI 候选不识别额度用尽。
