## 交付约定（下一阶段和验收会按这些读）

在已有 PRD 和任务计划（`docs/PRD.md`、`.ab/prd.json`、`.ab/tasks.json`、`UI_CONTRACT.md`、`_contracts/`）之上写这个文件并提交：

`.ab/test-plan.json`：验收测试计划。

```ts
interface TestPlanJson {
  cases: Array<{
    id: string;            // AT-001 起编
    title: string;         // 可证伪的断言：做什么、看到什么
    covers: string[];      // 它验证的验收标准 id（AC-NN，取自 docs/PRD.md）；验 .ab/arch.json 约束的写 CON- id
    level: "unit" | "integration" | "e2e";
    kind?: "acceptance" | "scenario" | "failure" | "boundary" | "volume" | "property" | "fuzz";
    backend?: "real" | "mocked";
    file?: string;         // 这条测试将落在哪个测试文件
  }>;
}
```

验收规则：

- PRD 里的每一条验收标准（`AC-NN`）至少被一条用例的 `covers` 覆盖。
- `covers` 里只写 PRD 里真实存在的 AC id（或 `.ab/arch.json` 里的约束 id）。
