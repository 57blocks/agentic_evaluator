## 交付约定（下一阶段和验收会按这些读）

在已有 PRD、设计和 API 契约（`docs/PRD.md`、`.ab/prd.json`、`docs/DESIGN.md`、`_contracts/`）之上写这些文件并提交：

1. `.ab/tasks.json`：任务计划。

```ts
interface TasksJson {
  domains: Array<{
    id: string;                 // 业务域，如 "member"
    name: string;
    dependsOn?: string[];       // 依赖的其他域 id
    tasks: Array<{
      id: string;               // T-001 起编，全计划唯一
      title: string;
      description: string;
      role: "architect" | "backend" | "frontend" | "test" | "fullstack";
      dependsOn: string[];      // 依赖的任务 id
      coversRequirementIds: string[];   // 它实现的需求：PAGE- / IC- / AC- / API- id
      files: { creates: string[]; modifies: string[] };
      subSteps: Array<{ action: string; detail: string }>;
      acceptanceCriteria: string[];
    }>;
  }>;
}
```

2. `UI_CONTRACT.md`：界面锚点约定，列出每个页面的关键元素与它们的 `data-testid`，供编码和测试共同遵守。

验收规则：

- PRD 里的每个页面（`PAGE-NNN`）都有 `role` 为 frontend 或 fullstack 的任务负责：把页面 id 写进那个任务的 `coversRequirementIds`。
- `_contracts/api-routes.json` 里的每个端点都被某个任务提到：以「大写方法 + 契约里的路径」的写法（如 `GET /api/tasks/:id`）出现在任务的 title、description、subSteps 或 acceptanceCriteria 里（只写在 files 里不算）。
- 域之间的依赖不成环：一个任务依赖另一个域的任务，就意味着它的域依赖那个域。
