# agb-models

agb 的**任务拆分**和**编码**两步，各该配哪个模型：同样的 agb、同样的输入，只换模型
（Opus 5 / Opus 5.5 / Sonnet 5），看谁把这一步做对。

| 步骤 | 输入（取自 agb 项目的 git 历史） | 候选跑什么 | 怎么算做对 |
|---|---|---|---|
| detail | 写 `.ab/tasks.json` 前一刻：PRD、设计、契约都在 | `claude -p` + stage-detail skill | 任务表能解析；覆盖与结构门禁（`page-coverage` / `contract-coverage` / `plan-domain-cycle`）零问题 |
| code | 每个 `[T-xxx]` 提交的前一刻：前面的任务已完成 | `agb run`，计划裁成只剩这一个任务 | 这个任务在计划里列出的验收测试，恢复原样后全部通过 |

一个项目有几个任务就有几个编码输入，所以一个项目就能凑出不少样本；一次编码只做一个
任务（agb 估 $2.46），比整个项目跑一遍轻得多。

## 加一个项目

```sh
node scripts/harvest.mjs <agb 项目目录> --name=<短名>
```

它从 git 历史里取快照到 `fixture/`、写输入到 `inputs/`，最后打印出要加进 `spec.yaml`
两个 `inputs:` 列表的名字。要求：agb 按任务提交（提交信息以 `[T-xxx]` 结尾），而且
编码输入要判得了，任务在计划里得列出自己的测试文件。

## 文件

- `agents/agb.mjs <model>`：读输入头部（stage / fixture / task），铺快照、设模型、跑这一步。
  花费上限每次 $10。`AGB_EVAL_DRY=1` 只铺好环境、不起执行器。
- `checks/plan-gates.mjs`、`checks/task-tests.mjs`：两个必过检查。门禁从 `AGB_HOME`
  （默认 `~/workspace/57b/agb`）里的 ab-gate 跑。
- `scripts/harvest.mjs`：从 agb 项目收输入。

## 参照

agb 当年在 agb-demo-todo 上的实际产出：任务拆分通过 `plan-gates`（经验规则记了
`task-granularity` 11 条、`ac-task-coverage` 1 条）。编码的逐任务结果见下一次校准。

## 跑

`pnpm agenteval plan agb-models` 先看计划（detail 3 次 + code 24 次），再加 `--yes`。
会花真钱，候选直接在本机运行。detail 用 `claude -p` 驱动，依赖本机 Claude Code 装了
agb 的 skills（agb-skills 插件）。
