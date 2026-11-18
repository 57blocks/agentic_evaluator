## 交付约定（下一阶段和验收会按这些读）

写这三个文件并提交：

1. `docs/PRD.source.md`：需求原文的原样副本（多份就按顺序拼在一起），不改一个字。
2. `docs/PRD.md`：规范化后的 PRD。保留原文的全部需求，不要改写或删掉原文内容；有歧义的地方登记成问题，而不是自己改需求。
3. `.ab/prd.json`：PRD 的机器可读索引，形状如下（TypeScript 写法，`?` 为可选）：

```ts
interface PrdJson {
  meta: { title: string; tier: "S" | "M" | "L"; sourceDoc: string };
  pages: Array<{
    id: string;            // PAGE-001 起编
    name: string;
    route: string;         // 应用内路由，如 /invoices/:id
    roles?: string[];
    layoutRegions?: string[];
    interactiveComponents?: Array<{ id: string /* IC-01 起编 */; name: string; type: string; interaction: string; effect: string }>;
    staticElements?: string[];
    states?: string[];     // 加载、空、错误等
    isEntry?: boolean;
  }>;
  endpoints?: Array<{ id: string /* API-001 起编 */; method: string; path: string; page?: string /* PAGE-id */ }>;
  acs?: Array<{ id: string /* AC-01 起编 */; text: string }>;
  domain?: {
    entities?: Array<{ type: string }>;
    variables?: Array<{ id: string /* VAR-01 */; name: string; description?: string }>;
    rules?: Array<{ id: string /* RULE-01 */; name: string; inputVariableId?: string }>;
    workflows?: Array<{ id: string /* WF-01 */; entity: string; initial: string; states: string[];
      transitions: Array<{ from: string; to: string; action?: string; actor?: string }> }>;
  };
}
```

验收规则：

- `docs/PRD.md` 里有一张页面路由索引表，每条路由一行（路径写在前三格之一），行里带它的 `PAGE-NNN`；若 PRD 用标题列出 API 端点（如 `### API-001 GET /api/invoices`），每个端点的标题行带 `API-NNN`。
- 验收标准逐条编号 `AC-NN`，写在 PRD.md 里；`.ab/prd.json` 的 id 与 PRD.md 一致。
- 下游要能照着建出来：每个页面写清职责、交互和状态，指明入口页；枚举、引用、数值前后一致，不自相矛盾。
- 需要问人的问题登记进 `.ab/questions.json`：`{"questions":[{"id":"Q-001","question":"…","kind":"decision|gap|scope|asset|secret","source":"出处（文件与位置）","blocks":["arch","code",…],"answer":"推荐答案（无人值守时按推荐落）","answeredBy":"eval-operator"}]}`；没有推荐的留空 answer。
