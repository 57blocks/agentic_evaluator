/**
 * 数据层 schema —— 表结构的唯一真相（agb-arch 产物）。
 *
 * 纪律（stack-conventions/data-layer）：
 *  · migration 是唯一的 schema 演进路径。改了这个文件就必须在同一次提交里
 *    带上 `drizzle-kit generate` 产出的新 migration。
 *  · 禁止 schema 自动同步：永远不要跑 `drizzle-kit push`。
 *  · 外键、唯一约束、索引都写在这里，让 migration 生成它们；
 *    只在应用层查询里保证唯一等于没有唯一。
 *
 * 金额一律 numeric(20, 2)：drizzle 把 numeric 读成字符串，与 DEC-007
 * 「用 decimal 字符串传输、不用 JS number」一致。
 * 租户隔离见 DEC-001：每张业务表带 org_id，查询强制带该谓词。
 */
import {
  pgTable, pgEnum, serial, varchar, text, timestamp, date, numeric,
  integer, jsonb, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

/* ---------- 枚举 ---------- */

export const clientTypeEnum = pgEnum('client_type', ['Enterprise', 'Personal']);
export const clientStatusEnum = pgEnum('client_status', ['Active', 'Frozen']);

export const invoiceTypeEnum = pgEnum('invoice_type', ['Regular', 'Recurring']);

/** WF-01。Voided 与 Error 是终态（Q-003 / Q-004）。 */
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'Draft', 'Sending', 'Pending', 'Received', 'Voiding', 'Voided',
  'Settling', 'Settled', 'Settlement Failed', 'Overdue', 'Error',
]);

/** 首发四个 Token，均为美元稳定币，1:1 计价（Q-016）。 */
export const paymentTokenEnum = pgEnum('payment_token', [
  'Tron-USDT', 'Tron-USDC', 'ETH-USDT', 'ETH-USDC',
]);

export const seriesStatusEnum = pgEnum('recurring_series_status', [
  'Active', 'Discontinued', 'Completed',
]);
export const seriesFrequencyEnum = pgEnum('recurring_frequency', [
  'Weekly', 'Bi-weekly', 'Monthly', 'Quarterly', 'Yearly',
]);
/** 两个值。`Manual Stop` 是对 No End Date 的说明，不是独立取值（Q-011）。 */
export const seriesEndTypeEnum = pgEnum('recurring_end_type', ['End Date', 'No End Date']);

/** Partial Success 已删除：一次只结算一个 Token，payout 不会部分成功（Q-053）。 */
export const settlementStatusEnum = pgEnum('settlement_status', [
  'In Progress', 'Success', 'Failed',
]);

export const actorEnum = pgEnum('status_log_actor', ['Merchant', 'System']);
export const idempotencyStateEnum = pgEnum('idempotency_state', ['in_flight', 'completed']);

/* ---------- 组织（租户） ---------- */

/**
 * DEC-009：只存档案，不存 Cobo 的 org access token。
 * name / logo_url 是快照，在换取会话时刷新；发票与邮件取这份快照而不是实时拉。
 */
export const organizations = pgTable('organizations', {
  orgId: varchar('org_id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  logoUrl: text('logo_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- 客户 ---------- */

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  orgId: varchar('org_id', { length: 64 })
    .notNull().references(() => organizations.orgId, { onDelete: 'restrict' }),
  clientEmail: varchar('client_email', { length: 255 }).notNull(),
  clientType: clientTypeEnum('client_type').notNull(),
  clientName: varchar('client_name', { length: 100 }).notNull(),
  status: clientStatusEnum('status').notNull().default('Active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // 邮箱唯一性按租户，不是全局 —— 两个组织可以各有同一个付款方
  emailPerOrg: uniqueIndex('clients_org_email_uq').on(t.orgId, t.clientEmail),
  listOrder: index('clients_org_created_idx').on(t.orgId, t.createdAt),
}));

/* ---------- 周期发票模板 ---------- */

/** Q-022：创建后不可编辑，除 Discontinue 外不对外暴露写接口。 */
export const recurringSeries = pgTable('recurring_series', {
  id: serial('id').primaryKey(),
  seriesId: varchar('series_id', { length: 64 }).notNull().unique(),
  orgId: varchar('org_id', { length: 64 })
    .notNull().references(() => organizations.orgId, { onDelete: 'restrict' }),
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  status: seriesStatusEnum('status').notNull().default('Active'),
  frequency: seriesFrequencyEnum('frequency').notNull(),
  endType: seriesEndTypeEnum('end_type').notNull(),
  endDate: date('end_date'),
  nextSendDate: date('next_send_date'),
  /** 生成单张 Invoice 用的发票字段快照 */
  templateSnapshot: jsonb('template_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dueScan: index('recurring_series_due_idx').on(t.status, t.nextSendDate),
}));

/* ---------- 发票 ---------- */

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  orgId: varchar('org_id', { length: 64 })
    .notNull().references(() => organizations.orgId, { onDelete: 'restrict' }),
  /** `<merchant>-YYYYMMDD-hash`，商户号前缀（Q-010）。也是 Cobo 侧的 psp_order_code（Q-056）。 */
  invoiceId: varchar('invoice_id', { length: 64 }).notNull().unique(),
  /** DEC-003：Payer 链接的不可枚举 token，不设过期。 */
  payerToken: varchar('payer_token', { length: 64 }).notNull().unique(),
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  seriesId: integer('series_id').references(() => recurringSeries.id, { onDelete: 'set null' }),
  invoiceType: invoiceTypeEnum('invoice_type').notNull().default('Regular'),
  status: invoiceStatusEnum('status').notNull().default('Draft'),

  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date').notNull(),

  category: varchar('category', { length: 100 }),
  memo: varchar('memo', { length: 500 }),

  // DEC-007：标量 USD，2 位小数。百分比字段是比率不是金额，单列精度。
  overallDiscount: numeric('overall_discount', { precision: 5, scale: 2 }).notNull().default('0'),
  amountWithoutTax: numeric('amount_without_tax', { precision: 20, scale: 2 }).notNull().default('0'),
  totalTaxAmount: numeric('total_tax_amount', { precision: 20, scale: 2 }).notNull().default('0'),
  discountAmount: numeric('discount_amount', { precision: 20, scale: 2 }).notNull().default('0'),
  /** Due ≡ total_amount，是展示别名不是独立字段（Q-009）。下限 1。 */
  totalAmount: numeric('total_amount', { precision: 20, scale: 2 }).notNull().default('0'),

  // Q-008：付款成功回调写入；Received 之前为空。事后按 Token 的汇总一律读这两列。
  paidToken: paymentTokenEnum('paid_token'),
  paidAmount: numeric('paid_amount', { precision: 20, scale: 2 }),

  /** Q-056：Create order link 当时拿不到 order_id，由首个 status 事件回填。 */
  coboOrderId: varchar('cobo_order_id', { length: 128 }),
  paymentUrl: text('payment_url'),

  voidReason: varchar('void_reason', { length: 500 }),
  errorReason: varchar('error_reason', { length: 500 }),

  sendTime: timestamp('send_time', { withTimezone: true }),
  receivedTime: timestamp('received_time', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  listOrder: index('invoices_org_created_idx').on(t.orgId, t.createdAt),
  byStatus: index('invoices_org_status_idx').on(t.orgId, t.status),
  /** Pending → Overdue 的定时扫描（DEC-011） */
  dueScan: index('invoices_status_due_idx').on(t.status, t.dueDate),
  /** 结算可选列表：按 org + paid_token + status 过滤（Q-021） */
  settleable: index('invoices_org_paidtoken_status_idx').on(t.orgId, t.paidToken, t.status),
  /** 回调按 psp_order_code（= invoice_id）反查已有 unique；order_id 回填后按它查 */
  byOrder: index('invoices_cobo_order_idx').on(t.coboOrderId),
}));

export const invoiceItems = pgTable('invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  itemName: varchar('item_name', { length: 100 }).notNull(),
  qty: integer('qty').notNull(),
  unitPrice: numeric('unit_price', { precision: 20, scale: 2 }).notNull(),
  /** 0 ≤ value < 100（Q-001） */
  discount: numeric('discount', { precision: 5, scale: 2 }).notNull().default('0'),
  tax: numeric('tax', { precision: 5, scale: 2 }).notNull().default('0'),
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull().default('0'),
}, (t) => ({
  perInvoice: uniqueIndex('invoice_items_invoice_position_uq').on(t.invoiceId, t.position),
}));

/** 允许付款方在 Cobo 托管页上选哪几种币（DEC-007）。独立表是为了列表按 Token 过滤。 */
export const invoicePaymentTokens = pgTable('invoice_payment_tokens', {
  invoiceId: integer('invoice_id').notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  token: paymentTokenEnum('token').notNull(),
}, (t) => ({
  pk: uniqueIndex('invoice_payment_tokens_pk').on(t.invoiceId, t.token),
  byToken: index('invoice_payment_tokens_token_idx').on(t.token),
}));

/** 每张发票最多 3 个（VAR-03 / CON-008），上限在服务端强制。 */
export const invoiceCcRecipients = pgTable('invoice_cc_recipients', {
  invoiceId: integer('invoice_id').notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
}, (t) => ({
  pk: uniqueIndex('invoice_cc_recipients_pk').on(t.invoiceId, t.recipientEmail),
}));

/** Q-023：只留状态变更流水，不做字段级版本历史。P0 不做展示界面。 */
export const invoiceStatusLogs = pgTable('invoice_status_logs', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  fromStatus: invoiceStatusEnum('from_status'),
  toStatus: invoiceStatusEnum('to_status').notNull(),
  actor: actorEnum('actor').notNull(),
  /** 外部回调参考：Cobo 的事件 id / order id / payout id */
  externalRef: varchar('external_ref', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byInvoice: index('invoice_status_logs_invoice_idx').on(t.invoiceId, t.createdAt),
}));

/* ---------- 结算 ---------- */

export const settlementRequests = pgTable('settlement_requests', {
  id: serial('id').primaryKey(),
  orgId: varchar('org_id', { length: 64 })
    .notNull().references(() => organizations.orgId, { onDelete: 'restrict' }),
  /** `SR-YYYYMMDD-hash`（Q-010）。同时作为 payout 的 request_id（Q-053）。 */
  requestId: varchar('request_id', { length: 64 }).notNull().unique(),
  /** Cobo 的 payout_id，回调后写入；写入前为空（Q-027 / Q-053）。 */
  settlementId: varchar('settlement_id', { length: 128 }),
  status: settlementStatusEnum('status').notNull().default('In Progress'),
  /** 一次只结算一个 Token（Q-021） */
  settlementToken: paymentTokenEnum('settlement_token').notNull(),
  destinationId: varchar('destination_id', { length: 128 }).notNull(),
  entryId: varchar('entry_id', { length: 128 }).notNull(),
  address: varchar('address', { length: 255 }).notNull(),
  invoiceCount: integer('invoice_count').notNull(),
  /** DEC-008：全额，不减手续费 */
  requestAmount: numeric('request_amount', { precision: 20, scale: 2 }).notNull(),
  coboPayEstimatedFee: numeric('cobo_pay_estimated_fee', { precision: 20, scale: 2 }).notNull().default('0'),
  /** MVP 恒为 0（Q-026） */
  invoiceServiceFee: numeric('invoice_service_fee', { precision: 20, scale: 2 }).notNull().default('0'),
  totalEstimatedFee: numeric('total_estimated_fee', { precision: 20, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  listOrder: index('settlement_requests_org_created_idx').on(t.orgId, t.createdAt),
  byStatus: index('settlement_requests_org_status_idx').on(t.orgId, t.status),
}));

/** 发票与结算的关联是纯我方账本，Cobo 不认（Q-053）。 */
export const settlementRequestInvoices = pgTable('settlement_request_invoices', {
  settlementRequestId: integer('settlement_request_id').notNull()
    .references(() => settlementRequests.id, { onDelete: 'cascade' }),
  invoiceId: integer('invoice_id').notNull()
    .references(() => invoices.id, { onDelete: 'restrict' }),
  /** 入选时的 paid_amount 快照，用于对账 */
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
}, (t) => ({
  pk: uniqueIndex('settlement_request_invoices_pk').on(t.settlementRequestId, t.invoiceId),
  byInvoice: index('settlement_request_invoices_invoice_idx').on(t.invoiceId),
}));

/* ---------- 跨切面 ---------- */

/**
 * DEC-010：Cobo 不提供幂等字段，去重由我方实现。事件顺序不保证，
 * 处理逻辑必须写成与顺序无关的形式。
 */
export const webhookEvents = pgTable('webhook_events', {
  id: serial('id').primaryKey(),
  /** Cobo 的事件 id；唯一索引即去重 */
  eventId: varchar('event_id', { length: 128 }).notNull().unique(),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  rawBody: text('raw_body').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

/**
 * DEC-005：键由客户端生成，原子占位靠唯一索引。
 * requestHash 用于分辨「同键同体」（回放原结果）与「同键不同体」（409）。
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: serial('id').primaryKey(),
  orgId: varchar('org_id', { length: 64 })
    .notNull().references(() => organizations.orgId, { onDelete: 'cascade' }),
  scope: varchar('scope', { length: 64 }).notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  state: idempotencyStateEnum('state').notNull().default('in_flight'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  claim: uniqueIndex('idempotency_keys_org_scope_key_uq').on(t.orgId, t.scope, t.key),
}));
