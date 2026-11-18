## 交付约定（下一阶段和验收会按这些读）

在已有 PRD（`docs/PRD.md`、`.ab/prd.json`）之上写这些文件并提交：

1. `_contracts/api-routes.json`：API 契约。

```ts
interface ApiRoutes {
  endpoints: Array<{
    method: string;               // GET / POST / PATCH / DELETE …
    endpoint: string;             // /api/invoices/:id
    domain: string;               // 归属的业务域
    auth: "public" | "required";
    audience?: "user" | "admin";
    prdJustification: string;     // 它服务哪些需求：引用 PAGE- / IC- / AC- id
    requestSchema: string;        // 请求形状（TypeScript 类型写法），无则 "none"
    responseSchema: string;       // 响应形状
  }>;
}
```

2. `docs/DESIGN.md`：系统设计，回答「为什么这么选」。每条设计决策一个标题：`## DEC-001 决策标题`，下面写理由与取舍。
3. `.ab/design.json`：决策索引，`{"decisions":[{"id":"DEC-001","title":"…","domains":["…"],"endpoints":["GET /api/…"],"tables":["…"]}]}`，id 与 DESIGN.md 一一对应。
4. `.ab/arch.json`：系统组成，`{"components":[{"id":"…","name":"…","domain":"…","owns":["…"],"dependsOn":["组件 id"]}],"constraints":[{"id":"…","target":"…","landsOn":"组件 id","verifiedBy":"…"}]}`。
5. 可选：`_contracts/schema.ts`（数据表结构）。

验收规则：

- PRD 里每个页面需要的数据都有端点提供；契约里至少有一个端点。
- 任何地方引用的 `DEC-NNN` 都必须在 DESIGN.md 里有定义（引用闭合）。
- 组件依赖不成环。
