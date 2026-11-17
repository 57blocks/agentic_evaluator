# agb-flow v3 方案（草案，2026-11-13）

## 要回答的问题

只测 Claude 订阅里的模型，在**最新 agb** 上回答：

1. 每一步用 opus 还是 sonnet 就够？
2. spec、architecture 值不值得用 Fable？
3. agb 的编排（skill、门禁、回修）比裸 `claude -p` 好多少？

agb 固定在 `0a8c4ee7`（origin/dev，2026-11-13），本轮中途不追 dev（`fix/e004-v20-run` 还在进行）。

## 默认决定（改哪条说一声即可）

- 测完整 agb，不测 agb-lite。CSMA 留给以后单独一轮测 agb-lite（只切一个域）。
- 编码后的代码评审与简化：开（`review.model` = 候选）。
- 收工审计（独立验收）：开。审计员固定为 opus，所有组都一样，不让候选自己审自己。
  `verifier` / `audit` / `seam` 三个槽都设 opus；`securityReview` 关；`load.enabled: false`。
- 候选占的槽：`models.spec` / `coding` / `escalation`、`review.model`。
- 额度用尽直接判失败（`AB_USAGE_WAIT_MAX_H=0`），整项目构建放在额度刚刷新时跑，撞上就重跑那一次。
- judge：先用 gpt-6.1-sol 重判 v2，和 grok 一致就换成 GPT；不一致先查 judge。

## 输入

| 步骤 | 输入 | 说明 |
|---|---|---|
| spec | chessicle、invoice | 客户原文 |
| architecture / task-breakdown / test-design | demo-todo、chessicle、invoice | demo-todo 只当底线，额度紧先砍 |
| implementation | demo-todo、invoice **整项目构建** | 三个项目在新版 agb 下都是小项目（invoice 实测 67,228 token < 80,000），编码是一个会话写完整份清单，不再按任务拆 |

implementation 的起点 = test-design 完成后的项目，加 `docs/PRD.source.md`、`scale: small`。
已验证：invoice 起点在最新 agb 的 tasks / test-plan 阶段 0 条 hard；`agb run --dry-run` 认出“35 个任务一个会话”。

## 评分

- 规划四步：原来的硬检查（按新门禁重新校准）+ judge 两两对比，维度不变。
- implementation 主分：留出测试集的通过率。
  - invoice：参考实现 `agb-e004-invoice` 的 Playwright e2e，今天在参考实现上 15/17 通过，只留这 15 个；
    再加改写成 HTTP 黑盒的 API 测试（参考实现 283 个白盒单测，只改写经由契约端点能到达的那部分）。
  - demo-todo：5 个服务端测试改成 HTTP 调用；按 UI_CONTRACT 的 39 个锚点补写 e2e。
  - 校准：参考实现全过、空项目全不过；sonnet 试水的每个失败人工判定是“候选的错”还是“测试太贴参考实现”，判完才计分。
- agb 自己的门禁结果、judge 两两对比作为参考。

## 阶段与关卡

0. **收尾 v2**：合并补跑结果并汇报；用 gpt-6.1-sol 重判 v2（约 $10–15）。
1. **准备**（1.5–2 天）：wrapper 对齐新 agb 与模型槽；fixture 加 scale；`check-task` 重新校准；做两份留出测试集并校准。
2. **smoke**：opus、sonnet 每步一个输入；Fable 订阅探测；确认单会话模式下 token 仍能上报。
3. **试水**：sonnet 跑一次 invoice 整项目构建（并发 1，超时 8 小时），实测时长、额度、完成度。过关再跑 opus。
4. **正式**（约 2–3 天）：
   - 规划四步：opus、sonnet × 11 个输入 = 22 次；Fable 在 spec、architecture 上 5 次。
   - implementation：opus、sonnet × demo-todo、invoice = 4 次（sonnet invoice 可复用试水）；
     sonnet demo-todo 再重复 2 次，看同一模型两次之间差多少（噪声底线）；
     裸 `claude -p`（不加载 agb 插件）opus、sonnet 各跑 demo-todo 一次——这是“agb 编排 vs 裸 claude”，每组只有一次。
   - 共约 35 次运行。整项目构建并发 1。

每个阶段过关再进下一阶段，每次开跑前确认。

## 花费

- 现金：judge 约 $15–20，加 v2 重判 $10–15。
- 订阅额度：规划步骤每次运行折合 $1–5；整项目构建在试水之前未知。本会话和候选共用同一份额度。

## 已知局限

- 每步 2–3 个输入，结论只能看方向；implementation 每组一次，算个案。
- invoice 的 e2e 把 API mock 掉了，只测得到前端；后端靠改写的 API 测试。
- 参考实现自己有 2 个 e2e、3 个单测是红的，已排除。
- 大项目（按域拆会话）这轮测不到，要靠以后的 CSMA 那一轮。
