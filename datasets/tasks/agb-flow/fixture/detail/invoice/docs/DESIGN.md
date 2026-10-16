# 系统设计：Cobo Invoice

**产出于** 2026-09-15 的 `agb-arch` 阶段。**这一份只回答「为什么这么选」。**
接口形状在 `_contracts/api-routes.json`，系统由哪几块组成在 `.ab/arch.json`，
表结构在 `_contracts/schema.ts`，每条决策的机器可读索引在 `.ab/design.json`。

裁决依据一律引用 `.ab/questions.json` 里的 `Q-*`，本文不复述那些裁决的正文。

## 这一版的前提

本仓库是 **agentic builder 的对照实验**：同一产品另有一份人手写的实现
（`/Users/57block/pythonproject/cobo-invoice-backend`，Python + FastAPI）。
按 `Q-068`，本轮**全部重写、不参考它**——参考对照组会污染实验结论。
两边的取舍出现分歧时以本仓库的裁决为准，分歧本身正是要测量的东西。
唯一的例外是**外部事实**（Cobo 平台自己定的接口语义与门户交接形态，见 `Q-069`）。

## 组件与域

九个组件（`.ab/arch.json`），域 id 在这里定义，`agb-detail` 的 `.ab/tasks.json`
沿用同一批：`auth` · `org` · `client` · `invoice` · `recurring` · `settlement` ·
`dashboard` · `payer` · `webhook`。

**Cobo 平台不是组件**。它是外部系统，不产出编码任务，也不拥有我们的端点或表；
组件表里因此没有它，`CMP-002` / `CMP-004` / `CMP-006` / `CMP-009` 各自在自己的
边界内调它。

页面与域的对应（`PAGE-*` 见 `.ab/prd.json`）：

| 域 | 页面 |
|---|---|
| `dashboard` | PAGE-001 Dashboard |
| `client` | PAGE-002 Client List（含 Add/Edit Client Modal） |
| `invoice` | PAGE-003 Invoice List、PAGE-004 Create、PAGE-005 Edit Draft、PAGE-006 Duplicate、PAGE-007 Detail（含 Void Modal、CC Modal） |
| `recurring` | 无独立页面——只在 PAGE-007 的周期区域呈现（`Q-013`） |
| `settlement` | PAGE-008 List、PAGE-009 Request、PAGE-010 Confirmation、PAGE-011 Detail |
| `payer` | PAGE-013 Payer Invoice Detail |
| `auth` / `org` | 无独立页面——PAGE-012 No Permission 由前端路由守卫渲染 |
| `webhook` | 无页面 |

`Send Reminder` 与 `Duplicate` **没有对应端点**：前者按 `Q-033` 走 `mailto`，
后者按 `Q-034` 是「读详情 + 新建草稿」，都由前端用已有端点组合完成。

---

## DEC-001 租户隔离用共享库加 org_id 列

**选了**：单库共享表，`clients` / `invoices` / `recurring_series` /
`settlement_requests` 各带一列 `org_id`，服务端每条读写查询强制带上它；
`org_id` 来自会话（`DEC-002`），前端不参与传递。

**为什么**：`Q-061` 裁定隔离单位是 Cobo 组织。`§NFR Security` 要求「按 Cobo
企业账户隔离」，而 Cobo Portal App 的整条链路上只有 `org_id` 这一个组织身份。
共享表加租户列是这个规模下唯一不增加运维面的做法——本版是单库单服务，
没有跨租户的容量或合规压力要求物理隔离。

**被拒的替代**：schema 隔离或每租户一库（本版没有任何需求要求它，却要引入
建库/迁移编排）；不分区的单租户（Portal App 可被任意组织安装，没有机制限制只装
一家，两家的发票会混在一个列表里）。

**必须写进代码的那一句**：`merchant_id = 5` 是 **Invoice 应用自己**在 Cobo
Payments 侧的收单主体（`Q-058`），是应用级常量，**不是租户键**。所有组织的收款
都落在这一个余额池里，因此「某组织能结算多少」由我方账本（该组织自己 Received
发票的 `paid_amount` 之和）决定，不由 Cobo 余额决定。

## DEC-002 商户会话用我方签发的 JWT，前端只放内存

**选了**：`POST /api/auth/session` 接收门户交付的 Cobo JWT，服务端按 Cobo 的
JWKS 取公钥验签，取出 `email` / `org_id` / `iss`，然后签发**我方自己的** JWT
返回。前端保存在内存中，不写 `localStorage` / `sessionStorage`，每次请求带
`Authorization: Bearer`。刷新页面或开新标签页重新走一次门户换取，**不做 refresh
token**。`org_id` 在服务端从 JWT 取，不信任任何请求参数里的组织标识。

**为什么**：`Q-062` 由人拍板。门户交付 Cobo JWT、JWKS 验签这两件是外部事实
（`Q-069`），我们没得选；「拿到之后怎么做」是我们的选择。不放 web storage 是
`security-hardening` 的硬约束（会话不得进 JS 能读的 storage）；不做 refresh 是
因为门户随时可以重新交付凭据，refresh 只省一次跳转却多一条长期有效的凭据。

**被拒的替代**：httpOnly cookie 会话（同样安全，但要额外处理 CSRF，而门户内嵌
场景的跨站上下文本身就不确定）；把 Cobo 的 org access token 交给浏览器
（泄露等于泄露整个组织在 Cobo 侧的权限，不只是发票数据）。

**契约后果**：`POST /api/auth/session` 是**唯一**一条 `auth: "public"` 的商户端
端点，且是公开写端点，因此必须限流（见 `rateLimit`）。其余 24 条商户端端点
一律 `auth: "required"`。

## DEC-003 Payer 链接用不可枚举 token，不设过期

**选了**：`/apps/invoice/pay/:token` 的 token 是不可枚举的值（≥128 bit 熵的随机
值或带密钥签名），**不设过期时间**。撤销靠业务状态：发票 Void 之后页面只读。
非 Pending 或已逾期时页面只读并隐藏 Pay Now（`§EH007`）。

**为什么**：`Q-067` 由人拍板，**本条修正 `Q-015` 的后半**（原裁决是「自 Due Date
起算固定天数后失效」）。`§EH007` 要求 Overdue / Received / Settled / Voided 等
状态下付款方打开链接仍能看到只读页与状态说明，任何过期时间都要比「还能付款的
窗口」宽得多；与其定一个没有依据的天数，不如不设。

**接受的风险（已明确告知并被选择）**：邮件被转发或邮箱泄露时，该发票的金额、
客户名与商品明细**永久可读**。缓解手段只有 token 本身的不可枚举性，因此
`CON-005` 要求对这条端点限流以压制枚举尝试——它是契约里唯一一条公开读端点。

**被拒的替代**：固定天数过期（原 `Q-015`，被这一条取代）；按发票状态失效
（逾期且永不付款的发票是非终态，链接同样永久存活，等于同一个风险换了个说法）。

## DEC-004 错误全站一种形状：HTTP 状态加 code/message

**选了**：所有端点失败时返回恰当的 HTTP 状态码 + `{ code: string; message: string }`。
`code` 是稳定的机器可读标识，`message` 是可直接展示给用户的英文文案。
校验失败额外带 `fields: { field: string; code: string; message: string }[]`，
供表单把错误渲染到字段旁（`§NFR Accessibility`「表单错误需在字段附近展示」）。

**为什么**：PRD 有大量逐字错误文案（`§Invoice Validation Error Copy` 等），它们
必须能被前端定位到具体字段。一种形状让所有调用方只写一次错误处理。

**被拒的替代**：每个端点自定义错误体（调用方无法预测，`stage-arch` 直接点名这是
该记 DEC 的切面）；RFC 7807 problem+json（更标准，但本项目没有跨组织的 API
消费者，多一层字段名映射没有收益）。

**永远不出现在错误响应里**：堆栈、SQL、内部表字段名、Cobo 的原始错误体。
`responseSchema` 里也因此没有它们——**能被观察到的行为就是承诺**。

## DEC-005 三条写端点用客户端生成的幂等键

**选了**：`idempotencyKey` 由客户端一次生成，写在这三条端点的 `requestSchema`
里（**不发明 header 字段**）：`POST /api/invoices/:invoiceId/send`、
`POST /api/invoices/:invoiceId/void`、`POST /api/settlements`。服务端用
`idempotency_keys` 表做**原子占位**（唯一索引冲突即命中），语义是：

- 同键 + 同请求体 且已完成 → 返回**原来那一次**的结果，HTTP 200
- 同键 + **不同**请求体 → 409，`code = "idempotency_key_reused"`
- 同键且**处理中** → 409，`code = "request_in_flight"`

**为什么**：AC-010、AC-019、AC-034 三条验收标准都要求重复点击不产生第二次副作用。
`stage-arch` 写得很明白：接受一个键却不兑现，比没有更糟——客户端会以为重试是安全的。
所以兑现方式在这里写死，不留给各域自己发挥。

**被拒的替代**：自然业务键去重（`send` 可以用 `invoice_id + status`，但 `void`
与 `settlements` 没有天然唯一键）；不允许重试、只靠前端禁用按钮（网络抖动下用户
会刷新页面重来，前端禁用拦不住）；202 + 轮询（本版三条都能在超时内给出确定结果，
多一个中间态就要多一套查询端点）。

**不是 exactly-once**：Cobo 回调按 at-least-once 对待，去重在 `DEC-010`。

## DEC-006 列表用 offset 翻页式分页，每页 20

**选了**：`page` / `pageSize` 入参，响应 `{ items, page, pageSize, total }`，
默认每页 20，默认 Create Time 倒序。Client / Invoice / Settlement 三个列表，
加上结算可选发票列表与结算详情的关联发票列表，形状完全一致。

**为什么**：`Q-028` 裁定了翻页式与页大小。`total` 是必需的——页码器要算总页数。
发票数量会随时间单调增长，`stage-arch` 明确要求「能长大就现在写进 schema」，
不等到有 100 条再加（那时加就是破契约）。

**被拒的替代**：cursor 分页（对大表更稳，但页码器渲染不出「共 N 页」，而 PRD 的
列表页设计就是页码器）；不分页（一屏装不下的那刻就要破契约）。

## DEC-007 金额收敛为标量 USD，用 decimal 字符串传输

**选了**：`unit_price`、item `amount`、`amount_without_tax`、`total_tax_amount`、
`discount_amount`、`total_amount` 全部是**单值 USD**、**2 位小数**，在契约与
数据层里都用 **decimal 字符串**（`"100.00"`）而不是 JSON number。
`payment_tokens` 数组保留，语义是「允许付款方在 Cobo 托管页上选哪几种币」。
`primary_token` **删除**。`paid_token` / `paid_amount` 保留，由付款成功回调写入。

**为什么**：`Q-063` 由人拍板收敛，`Q-057` 定了 2 位。`Q-016` 已定四个 Token 都是
美元稳定币、1:1 计价，按币定价的各值必然相同；而 `Q-056` 定了传给 Cobo
`Create order link` 的是 `pricing_currency = USD` + `pricing_amount` **单值**——
按币定价连传都传不出去。`primary_token` 在原文里的唯一用途是「未付款列表金额
显示主币」，USD 计价下列表直接显示 USD，它没有读者了。

decimal 字符串而不是 number：JS 的 `number` 是 IEEE754 双精度，`0.1 + 0.2` 就
不等于 `0.3`；金额一旦在序列化边界上过一次 number，2 位小数的不变量就不再有
保证，而 `CON-004` 说得很清楚——payout 的 amount 超过两位非零小数会被 Cobo
**拒绝而不是四舍五入**。

**被拒的替代**：保留 `Token → Decimal` 的 Object 形状（同时推翻 `Q-016` 与
`Q-056`，且原型自己的样例数据里各币价格就全都相同）；用 number 传金额
（省一次解析，换来一类无法在类型系统里发现的错账）；最小单位整数（分）
（避免了浮点，但每个展示点都要除 100，且与 Cobo 接口的 decimal 字符串不一致）。

## DEC-008 payout 提全额，手续费从余额另扣

**选了**：`POST /payments/payouts` 的 `amount` = 所选发票 `paid_amount` 之和，
**不减手续费**。手续费由 Cobo 从 `merchant_id=5` 的余额另扣。确认页的「总金额」
与「预估费用」两行因此就是字面意思。`invoice_service_fee` 恒为 0（`Q-026`），
`total_estimated_fee` 只等于 Cobo 返回的 `cobo_pay_estimated_fee`。

**为什么**：`Q-064` 由人拍板。`Q-054` 定了容差 0、多付少付一律进 Error，所以
Received 发票的实收**恒等于面额**（2 位小数），求和仍是 2 位，必然通过 `CON-004`
那条约束。而净额方案要做减法，预估费的小数位由 Cobo 返回、不保证 2 位，相减后
很可能超过两位非零小数，直接被拒。

**已知代价，不在本版处理**：所有组织共用一个余额池（`DEC-001`），累计手续费会
啃掉池子，需运营侧补足。本版**不做**提交前余额校验——余额不足表现为 payout
失败回调 → Settlement Request = Failed → 所选发票回 Settlement Failed，可重试。
PRD 与台账里从没有过「余额不足」这个概念，凭空造一条失败路径属于发明需求。

**被拒的替代**：净额提款（上面那条小数位问题）；提交前查余额并拦截（多一次外部
调用与一整条 PRD 里不存在的失败路径）。

**提交前的预估走独立端点**（`Q-070`，`agb-detail` 阶段补）：`POST /api/settlements/estimate`
无副作用、不创建记录、不带幂等键，入参与 `POST /api/settlements` 一致，服务端转调
Cobo 的 `Estimate fees`。它存在的理由是 `§Page Responsibilities` 要求
Settlement Confirmation Page 在**提交之前**展示预估费用，而原契约里
`coboPayEstimatedFee` 只在提交后的响应里——那一页的 Must Show 因此有一个字段
没有数据来源。

## DEC-009 Cobo 的 org access token 不落库，按需换取并进程内缓存

**选了**：`organizations` 表只存 `org_id` / `name` / `logo_url`。Cobo 的
org access token **不写库**：需要调 Cobo 时用 App Key + `org_id` 现换，
在进程内按 `org_id` 缓存并带 TTL，失效即重换。

**为什么**：那是一枚能代表整个组织操作 Cobo 的凭据。落库意味着数据库泄露的
影响面从「发票数据」扩大到「客户在 Cobo 侧的资产操作权限」，而换取成本只是一次
HTTP 调用。`security-hardening` 的取向是密钥当圣物——能不持久化就不持久化。

**被拒的替代**：access token + refresh token 落库（少一次换取调用，多一处静态
高价值凭据，且要自己处理轮换与失效）；每次调用都现换不缓存（可行，但高频页面
会对 Cobo 产生无谓压力）。

**组织名与 Logo 是快照**：`name` / `logo_url` 落库，在 `POST /api/auth/session`
时刷新。发票的 `from_name` 与邮件模板取这份快照，**不在渲染时实时拉**——否则
一张历史发票的商户名会随组织改名而变，而发票是商业单据。

## DEC-010 回调按原始字节验签，事件 id 落库去重

**选了**：`POST /api/webhooks/cobo` 必须在**解析请求体之前**拿到原始字节做验签
（`Q-018`：签名覆盖 `raw_body|timestamp`，双 SHA-256 后用 Ed25519 以按环境硬编码
的 Cobo 公钥验）。同时读**两种拼法**的头（`BIZ_RESP_SIGNATURE` 与
`BIZ-RESP-SIGNATURE`），因为 nginx 默认丢弃含下划线的头。验签通过后把事件 id
写进 `webhook_events`（唯一索引），冲突即视为重复投递，直接返回成功不再处理。

**为什么**：`Q-018` 查证的结论是 **Cobo 不提供幂等字段，去重由我方实现**，且
**事件顺序不保证**。所以每个处理分支都必须写成与顺序无关的形式：用「目标状态
是否已达成」判断，而不是「当前状态是不是上一个状态」。

**被拒的替代**：反序列化后再序列化来验签（会丢 null/空字段并重排键序，验签必败
——这是 `Q-018` 明确记下的坑）；靠 Cobo 的重试次数当作「最终一致」而不去重
（Webhook 最多 10 次、Callback 最多 30 次，不去重就是 10 次状态推进）。

**多付的判定必须显式实现**：收到 `payment.order.status.updated` 后须拉
`Get pay-in order information`，比对 `received_token_amount` 与 `payable_amount`
——相等置 Received，大于置 Error（`Q-054`）。**多付在 Cobo 侧同样落 Completed，
无法由状态识别**，这条比对逻辑原文里没有写过，漏了就会把多付当成正常收款。

## DEC-011 定时任务用同进程 cron，靠幂等键而不是单实例保证不重复

**选了**：三件定时工作（周期发票到点生成、Pending 到期转 Overdue、Sending/Voiding
卡住 24 小时的检出）跑在后端服务的同一个进程里。**不假设只有一个实例**：
周期生成以 `(series_id, 应发送日期)` 为幂等键、唯一索引占位；逾期推进是幂等的
条件更新（`status = 'Pending' AND due_date < now()`）。

**为什么**：`Q-037` 定了同进程 cron。但「同进程」不等于「单实例」——横向扩两个
实例时两个 cron 会同时醒来，而 `Q-022` 要求「不静默重复生成发票」。把正确性
挂在部署拓扑上，是一个在扩容那天才会炸的假设；挂在唯一索引上则与实例数无关。

**被拒的替代**：独立调度服务或外部队列（本版三件事都轻，多一个部署单元换不来
什么）；靠分布式锁（还是要处理锁过期与持有者崩溃，而幂等键更简单且更强）；
靠「只部署一个实例」的约定（约定不会在扩容时报错）。

## DEC-012 技术栈与目录布局

**选了**（`Q-066`，词表内的取值同时写进 `.abrc.json` 的 `stack`）：

| 维度 | 取值 | 判据 |
|---|---|---|
| languages | `ts` | 既有安装里有 `typescript@5.9.3`；`Q-037` 定了 React + Node |
| frontend | `react-router` | 既有安装里有 `react@19` + `vite@7` 且**没有** next；`Q-037` 的「前后端分离」与 `Q-014` 的 `/apps/invoice/*` 挂载都指向 SPA |
| backend | `koa` | `Q-037` 已裁决，`koa@3.2.1` 已安装 |
| data | `drizzle` | `drizzle-orm` / `drizzle-kit` / `pg` 均已安装；门禁支持度在「该跑的都能跑」那一档 |
| api | **REST** | 自用 SPA、无多端消费、无对外开放 |
| chain | 不选 | 本产品不碰链，链上交互全在 Cobo 侧 |

**`.abrc.json` 的 `stack.api` 是空的，这是故意的**：REST 没有正向特征
（没有 SDL、没有 `.proto`、没有 tRPC router），`resolveStack` 探不到它，词表里
因此没有这个取值。写 `"rest"` 会是一个词表外的假值。

**目录布局**：`apps/web`（前端）· `services/api`（后端）· `_contracts/`
（共享契约与数据层 schema）。**这一步不建目录、不装依赖**，所以
`.abrc.json` 的 `layout` **暂时不写**——`layout-declared` 会检查声明的路径是否
真的有东西，一个指着空目录的声明比不声明更贵（读布局的门禁会安静地扫一个空集合，
然后给出一份干净的报告）。脚手架在编码期落地后补声明。

**agb 判不了的三个配套项**（照实记录）：包管理器 **pnpm**（既有事实：
`node_modules/.modules.yaml` 的 `hoistedDependencies` 结构）；边界校验库
**zod**（尚未安装）；前端服务端状态 **@tanstack/react-query**（尚未安装，见 `DEC-014`）。

**被拒的替代**：`next-app`（会多出一个 SSR 服务端，与 `Q-037` 已定的「Koa 独立
服务」职责重复）；`prisma`（门禁支持度与 drizzle 相同，但多一个 codegen 步骤，
且 `drizzle-kit` 已经装好了）；`trpc`（端到端类型很好，但把前后端在编译期绑死，
与「前后端分离、契约先行」的取向相反）。

## DEC-013 浏览器直连 api-routes，不做 BFF

**选了**：前端直接调 `_contracts/api-routes.json` 里的端点，中间不加聚合层。
需要多份数据的页面（Dashboard 四个图表、Settlement Confirmation）并发发多个请求。

**为什么**：只有一个前端消费者，且已经是前后端分离。BFF 的收益（为特定屏幕裁剪
响应、合并调用）在这里换来的是每条端点要维护两遍。Dashboard 的四个指标各有
独立的时间范围参数与独立的 loading 状态，本来就该是四条独立请求。

**被拒的替代**：BFF 聚合层（多一层要写、要测、要部署的东西，且每加一条端点都要
在两处改）；GraphQL（同理，且 `DEC-012` 已定 REST）。

## DEC-014 服务端状态用共享 query cache，不用全局 store

**选了**：所有服务端数据走一个共享的 query cache（`@tanstack/react-query`），
按端点 + 参数作为 key。写操作成功后按 key 失效相关查询，不手工搬运数据。
**客户端状态**（表单草稿、弹窗开关）留在组件里，不进这个 cache。

**为什么**：`stage-arch` 点名「每个域各选一套 cache，集成时才炸」。发票列表、
详情、Dashboard、结算可选发票之间有真实的失效关系——作废一张发票要同时影响
列表、状态计数和 Dashboard 的 Unreceived。有一个统一的失效入口，这件事才写得对。

**被拒的替代**：每页自己 `fetch`（上面那组失效关系要在每个页面手写一遍，
必然漏）；全局 store（Redux 之类）（把服务端数据当客户端状态管，要自己实现
缓存、失效、重复请求合并——那正是 query cache 已经做完的事）。

**这不是重复 `stack-conventions/react` 的硬规则**：typed client、挂载 fetch 接
`AbortController`、错误必须触达用户，那些是栈约定，门禁已经查。这一条记的是
「本项目在两个都成立的方案里选了哪一个」。

## DEC-015 列表的筛选与分页写进 URL

**选了**：Client / Invoice / Settlement 三个列表的搜索词、过滤条件、页码写进
URL query string。详情页返回列表时按 `§Basic Manageable-Object Page Rules`
的要求**保留筛选条件**——靠的就是 URL，不是内存里的状态。

**为什么**：PRD 明确写了「从 Invoice List 进入的详情返回 Invoice List，并保留
筛选条件」。把这个状态放在组件里，浏览器后退和刷新都会丢；放 URL 里则顺带
支持了分享和收藏。

**被拒的替代**：只放组件 state（后退/刷新即丢，且要额外写一套返回时的状态恢复）。

## DEC-016 写操作等响应再改 UI，不做乐观更新

**选了**：所有写操作在按钮上显示 loading 并禁用，等服务端响应后再改 UI 与失效
缓存。失败时保留用户输入、原地重试。

**为什么**：这个产品的写操作几乎全部会**跨状态机**，且成功与否取决于外部系统
——Create&Send 进 Sending 之后还要等链接与邮件（`DEC-019`），Void 进 Voiding
之后还要等 Cobo 回调，结算提交还可能剔除发票（`DEC-018`）。乐观更新要为每一条
都编一个「猜测的结果」，而这些操作的真实结果服务端自己都还不知道。PRD 的
`§Key Action Feedback` 表也逐行写的是 loading + toast。

**被拒的替代**：乐观更新 + 回滚（收益是感知延迟，代价是为十几条写操作各编一份
猜测状态与回滚逻辑，且猜错时用户会看到状态跳变）。

## DEC-017 外部调用 120 秒超时且不自动重试

**选了**：三条用户发起的外部调用统一 120 秒超时、**不自动重试**。超时即按既定
路径回滚：Create&Send 先撤销已生成的支付链接再回 Draft（`Q-006`）、Void 回
Pending、Settlement 不创建并保留选择。重试一律由用户再次点击发起。

**为什么**：`Q-017` 裁定。自动重试在这三条上都危险——它们都有副作用，而
`DEC-005` 的幂等键是**客户端**生成的，服务端自己发起的重试拿不到新意图，只会
把一次不确定的失败变成两次不确定的失败。

**被拒的替代**：自动重试若干次（上面那条）；更短的超时（Cobo 的链接生成与
payout 提交都可能慢，过短会把成功的调用判成失败，而回滚一个其实成功了的操作
更贵）。

**定时任务不适用这一条**：周期生成没有用户在场，无人可点重试，因此单独定了在
当次任务内重试 3 次（`Q-022`，见 `CON-009`）。

## DEC-018 结算提交用乐观锁剔除被占用的发票，不整单失败

**选了**：`POST /api/settlements` 对每张发票做带前置条件的状态更新
（`status IN ('Received','Settlement Failed')` 才可进 `Settling`）。已被别的请求
占用的发票**剔除**，剩余发票照常提交，被剔除的 id 在响应的 `removedInvoiceIds`
里告知商户。不整单失败，不做预占。

**为什么**：`Q-050` 裁定。两个结算请求选中同一张发票是真实会发生的（同一组织的
两个人同时操作），而整单失败会让先到的那一单也白做。

**被拒的替代**：整单失败并提示刷新（用户要重新勾一遍，而冲突可能只涉及一张）；
进入选择页时预占发票（要处理「选了不提交就离开」的释放，多一套超时回收）。

**契约后果**：`removedInvoiceIds` 是 `responseSchema` 的一部分，前端**必须**渲染
它——一个被静默剔除的发票会让商户以为钱已经在路上了。

## DEC-019 发票邮件由 Cobo 发，我方不接第三方邮件服务商

**选了**：发票邮件与通知邮件由 Cobo 提供的邮件能力发出，我方不自建也不接第三方
服务商。邮件调用是我方服务端 → Cobo 的内部调用，**不出现在**
`_contracts/api-routes.json` 里；我方契约只暴露 `POST /api/invoices/:invoiceId/send`。

**为什么**：`Q-065` 由人拍板，与 `Q-058`（merchant_id 带外注册）、`Q-059`
（destination 带外注册）同一取向——能交给 Cobo 的就不在本产品内建。

**发送是异步的，不是请求内同步等待**：`§EH004`「Sending 超 24 小时」这条异常的
存在本身就决定了它——一个同步请求不可能卡 24 小时。所以 `send` 端点收下请求即
返回 `status: "Sending"`，链接生成与邮件发送在其后的后台流程里完成，成功才
推进到 Pending。

**这一条有一个未闭合的已知项**：`Q-065` 的 `followUp` ——Cobo 支付侧的文档站与
OpenAPI spec 里**没有邮件端点**，所以「Cobo 提供邮件能力」目前是取向而不是查证
结果。它 `blocks: code`，不挡本阶段；编码期须先向 Cobo 确认端点规格。

**被拒的替代**：自接第三方邮件服务商（要多管一个服务商、一套密钥、一个发信域名
的 SPF/DKIM 与退信率）。

## DEC-020 同一份契约只活一个版本，新字段只加 optional

**选了**：`_contracts/api-routes.json` 只维护一个版本。演进方式是**只加 optional
字段**，不改已有字段的类型、不删字段。真要不兼容变更才开 `/v2`，而那本身要另记
一条 DEC。

**为什么**：只有一个前端消费者，且它与后端同步发布。多版本会把维护面直接翻倍，
换来的是这个项目并不需要的「旧客户端继续可用」。

**被拒的替代**：一开始就带版本前缀 `/api/v1/*`（在只有一个同步发布的消费者时是
纯粹的仪式，且会诱导「反正能开 v2」的不兼容改动）。

---

## 契约上两处刻意的偏离，以及为什么

**1. 两条 destination 读端点没有分页。** `GET /api/org/destinations` 与
`GET /api/org/destinations/:destinationId/entries` 是对 Cobo destination 注册表的
**透传读**（`Q-059`，只读不写）。分页形状必须跟随 Cobo 自己的分页形式，而那一
部分我没有查证过；现在按 offset 写一个我们兑现不了的 `page` / `pageSize`，是给
下游一条幻觉线索。注册与审批在 Cobo Portal 带外完成，取值集合由人维护、规模受控，
因此本版不分页。**这一条在接入 Cobo 时必须复核**：如果 Cobo 那边就是分页返回的，
这两条端点要同步补上与它一致的游标形状。

其余七条列表端点都已按 `DEC-006` 写了分页。`GET /api/invoices/:invoiceId` 与
`GET /api/pay/:token` 的 `items` 是发票行项目（上限 50 行，`CON-008`），不是列表。

**2. 两条 webhook 端点没有写 `audience`。** 该字段只认 `"user"` / `"admin"`
两个取值，而 `POST /api/webhooks/cobo` 与 `POST /api/webhooks/portal-install`
的调用方是 Cobo 的服务器，两个取值都不是真的。与其填一个字面上成立而实际错误的
值，不如留空——**幻觉线索比没有线索更贵**。两条的 `auth: "public"` 与
`rateLimit: "required"` 都照写，它们才是这两条端点真正被判定的字段。

## 编码期必须先做、本阶段刻意没做的事

这两件不是遗漏，是本阶段的纪律（`stack-selection`：这一步不创建目录、不装依赖）：

1. **初始 migration 尚未生成。** `_contracts/schema.ts` 是本阶段的产物，但
   `drizzle-kit generate` 需要 `package.json` 与已安装的依赖。编码期第一个任务
   必须是「脚手架 + `drizzle-kit generate`」，在此之前 `schema-migration`（hard）
   会正确地拦住提交——**那不是误报**。手写 drizzle 的 snapshot/journal 会让后续
   的 diff 静默出错，所以本阶段不伪造它。
2. **`.abrc.json` 的 `layout` 尚未声明**，理由见 `DEC-012`。

**`GET /api/health` 是这四样里的第一样**（`agb-detail` 阶段补进契约）：`auth: "public"`、
不读数据库、不暴露任何业务或环境信息，`prdJustification` 里照实标注了它**不是 PRD
功能**而是 `runtime-smoke` 的存活探针。它不在 P0 功能清单里，所以没人会替它拆一条
任务——`.ab/tasks.json` 的 `T-001` 专门认领它。

## 未闭合的已知项

台账 69 条中 `blocks` 非空且无答案的有 **0** 条。仍开着的 `followUp` 6 条，
都不挡本阶段：

| followUp | 归属 |
|---|---|
| `Q-020` discount_amount 是否显示为负数 | detail（展示口径） |
| `Q-022` Discontinue 与到期完成的反馈文案 | detail（逐字文案） |
| `Q-025` 支付取消态与超时态文案 | detail（并入 `Q-032` 的统一文案表） |
| `Q-032` 断网/第三方不可用的逐字英文文案 | detail（随 UI 契约补齐） |
| `Q-036` 四家浏览器最低版本、Payer H5 基线 | detail（UI 契约的取值） |
| `Q-065` Cobo 邮件端点规格未经验证 | **code**（见 `DEC-019`） |
