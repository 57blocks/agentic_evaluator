# UI Contract

下游必须渲染的锚点。每条三件事：稳定 id、具体 DOM 落点、哪条交互或断言消费它。

**这份文件只管锚点，不管文案。** label / placeholder / hint 的真相是
docs/prototype.html，编码会话会拿到它。这里写文案会变成第二份真相。
颜色、间距、字号在 .ab/design-tokens.json。

**控件类型已逐个对回原型，不要改**：Client Type 是 radio 组（prototype.html:765）
而不是下拉；Payment Token 是多选勾选（prototype.html:1550）；Void 原因是 textarea
（prototype.html:816）；创建发票页的 Client 选择器按 Q-071 是可搜索 combobox
而不是原型里那个 select（那个画法只在 demo 的 3 条数据下成立）。
付款方页**没有**币种选择器 —— Q-056 已删除该模块，币种在 Cobo 托管页选。

## 应用骨架（auth 域，所有商户端页面共用）

- `app-shell` — 应用根容器 div；断言已登录态下渲染了商户端布局
- `app-sidebar` — 248px 固定左侧栏 nav；断言 Payer 视角下不渲染
- `nav-dashboard` — 侧栏导航项 link；跳转 Dashboard
- `nav-clients` — 侧栏导航项 link；跳转 Client List
- `nav-invoices` — 侧栏导航项 link；跳转 Invoice List
- `nav-settlements` — 侧栏导航项 link；跳转 Settlement List
- `app-org-name` — 当前组织名 span；断言取自会话而非硬编码
- `global-toast` — 全局提示容器 div；断言所有成功与失败反馈文案
- `offline-banner` — 断网页顶横幅 div；断言离线态出现且期间不提交新请求

## PAGE-012 No Permission

- `no-permission-page` — 无权限页根容器 div；AC-003 与 AC-028 断言直接访问商户端路由时渲染它

## PAGE-001 Dashboard

- `dashboard-page` — 页面根容器 div；断言默认落地页
- `dash-date-from` — Invoice Sent 起始日期 input；AC-025 与 AC-026 选择日期范围
- `dash-date-to` — Invoice Sent 结束日期 input；同上
- `dash-range-error` — 日期范围错误容器 div；AC-026 断言超过 15 天时的提示
- `chart-invoice-sent` — Invoice Sent 堆叠柱图容器 div；AC-025 断言按状态堆叠
- `chart-invoice-sent-table` — 图表的文本替代数字表 table；断言无障碍替代存在（Q-036）
- `kpi-unreceived` — Unreceived 卡片 div；断言未收总额
- `unreceived-range-tabs` — 未收范围切换 tab 组；切换 30 / 90 / 120 天与全部
- `unreceived-notdue-amount` — 未到期金额 span；断言 Not Due 与 Overdue 拆分
- `unreceived-overdue-amount` — 逾期金额 span；同上
- `dash-month-select` — Received Invoice 的年月选择 select；切换统计月份
- `panel-received-token` — 按 Token 汇总面板 div；断言按 paidToken 分组
- `panel-last-received` — 最近一次收款面板 div；断言金额、付款方、日期
- `dashboard-empty` — 无数据空状态容器 div；AC-027 断言空图表与引导创建发票

## PAGE-002 Client List

- `client-list-page` — 页面根容器 div；断言导航可达
- `client-search-input` — 按邮箱或名称搜索 input；触发列表筛选
- `client-type-filter` — 客户类型过滤 select；注意这一个才是下拉（prototype.html:327）
- `client-status-filter` — 客户状态过滤 select；按 Active 与 Frozen 过滤
- `client-table` — 客户表格 table；断言列与排序
- `client-row` — 客户表格行 tr，每行一个；断言行内容与操作可见性
- `client-status-badge` — 行内状态标签 span；断言冻结后变为 Frozen
- `client-empty` — 空状态容器 div；AC-004 断言空态与添加入口
- `client-pagination` — 分页器 nav；断言每页 20 条与翻页
- `client-add-btn` — 新增客户按钮 button；打开新增弹窗
- `client-edit-btn` — 行内编辑按钮 button；打开编辑弹窗
- `client-freeze-btn` — 行内冻结按钮 button；打开冻结确认
- `client-unfreeze-btn` — 行内解冻按钮 button；打开解冻确认

### Add/Edit Client Modal（PAGE-002 与 PAGE-004 共用，不占路由）

- `client-modal` — 弹窗根容器 div；断言打开与关闭
- `client-email-input` — 客户邮箱 input；AC-002 断言必填校验，编辑态断言只读
- `client-type-enterprise-radio` — 企业类型单选 radio；选择 Enterprise
- `client-type-personal-radio` — 个人类型单选 radio；选择 Personal
- `client-name-input` — 客户名称 input；AC-005 断言 3 到 100 字符校验
- `client-email-error` — 邮箱字段错误容器 div；断言必填、格式、重复三种提示
- `client-type-error` — 类型字段错误容器 div；断言未选类型的提示
- `client-name-error` — 名称字段错误容器 div；断言长度校验提示
- `client-modal-submit-btn` — 提交按钮 button；AC-001 断言提交中禁用且不可重复提交
- `client-modal-cancel-btn` — 取消按钮 button；断言关闭且不保存

### Freeze/Unfreeze Confirm Modal

- `client-freeze-modal` — 冻结与解冻确认弹窗 div；断言打开
- `client-freeze-confirm-btn` — 确认按钮 button；提交状态变更
- `client-freeze-cancel-btn` — 取消按钮 button；关闭弹窗
- `client-freeze-blocked-error` — 存在进行中发票时的阻止提示 div；断言 7 个进行中状态下不可冻结（Q-007）

## PAGE-003 Invoice List

- `invoice-list-page` — 页面根容器 div；断言导航可达
- `invoice-status-chips` — 状态计数胶囊组 div；断言计数覆盖全量而非当前页
- `invoice-search-input` — 按客户名或分类搜索 input；触发筛选
- `invoice-type-filter` — 发票类型过滤 select；按 Regular 与 Recurring 过滤
- `invoice-token-filter` — Token 过滤 select；按可付款币种过滤
- `invoice-status-filter` — 状态过滤 select；按发票状态过滤
- `invoice-created-from` — 创建时间起始 input；按创建时间过滤
- `invoice-created-to` — 创建时间结束 input；同上
- `invoice-table` — 发票表格 table；断言列与默认倒序
- `invoice-row` — 发票表格行 tr，每行一个；断言行内容与操作可见性
- `invoice-status-badge` — 行内状态标签 span；断言状态流转后的显示
- `invoice-stuck-tooltip` — 中间态超时提示 tooltip；断言 Sending 或 Voiding 超 24 小时时出现
- `invoice-empty` — 空状态容器 div；断言首次进入的空态
- `invoice-pagination` — 分页器 nav；断言每页 20 条与翻页
- `invoice-create-btn` — 新建发票按钮 button；进入创建页
- `invoice-view-detail-btn` — 行内查看详情按钮 button；进入详情页
- `invoice-edit-btn` — 行内编辑按钮 button；AC-013 断言非 Draft 时置灰不可点
- `invoice-duplicate-btn` — 行内复制按钮 button；进入复制页，Settling 状态外均可用（Q-034）
- `invoice-void-btn` — 行内作废按钮 button；Pending 与 Overdue 可用，打开作废弹窗
- `invoice-reminder-btn` — 行内催缴按钮 button；Pending 与 Overdue 可用（Q-033）

### Void Invoice Modal（不占路由）

- `void-modal` — 作废弹窗根容器 div；断言打开
- `void-reason-textarea` — 作废原因 textarea；AC-016 与 AC-017 断言 3 到 500 字符校验
- `void-reason-error` — 原因字段错误容器 div；断言空原因时阻止提交
- `void-submit-btn` — 提交作废按钮 button；AC-019 断言处理中禁用、重复点击只处理一次
- `void-cancel-btn` — 取消按钮 button；关闭弹窗

## PAGE-004 / PAGE-005 / PAGE-006 发票表单（创建、编辑草稿、复制共用）

- `invoice-form-page` — 表单页根容器 div；断言三种模式都渲染同一套字段
- `invoice-id-field` — 发票号只读展示 span；断言复制时生成新号
- `invoice-from-field` — 开票方只读展示 span；断言取自组织档案快照，不可编辑
- `invoice-issue-date-input` — 开票日期 input；断言不得晚于当前日期
- `invoice-due-date-input` — 到期日期 input；断言默认当前日期加 30 天且不得早于今天
- `invoice-client-combobox` — 客户选择可搜索输入框 input；Q-071 断言输入即筛选、只出 Active 客户
- `invoice-client-options` — 客户候选列表容器 div；断言键盘可达与候选来自服务端搜索
- `invoice-client-error` — 客户字段错误容器 div；断言未选客户与冻结客户两种提示
- `invoice-add-client-btn` — 在表单内新增客户按钮 button；打开 Add Client 弹窗
- `invoice-cc-open-btn` — 打开 CC 弹窗按钮 button；维护抄送人
- `invoice-token-tron-usdt` — Tron-USDT 勾选项 checkbox；多选付款币种
- `invoice-token-tron-usdc` — Tron-USDC 勾选项 checkbox；同上
- `invoice-token-eth-usdt` — ETH-USDT 勾选项 checkbox；同上
- `invoice-token-eth-usdc` — ETH-USDC 勾选项 checkbox；同上
- `invoice-token-error` — 币种字段错误容器 div；AC-007 断言未选币种时阻止提交
- `invoice-items` — 商品行容器 div；断言至少一行
- `invoice-item-row` — 单个商品行 div，每行一个；断言增删与计算
- `invoice-item-name` — 商品名称 input；断言必填
- `invoice-item-qty` — 数量 input；断言必须是大于 0 的整数
- `invoice-item-unit-price` — 单价 input；DEC-007 断言单值 USD、2 位小数，不是按币多个输入框
- `invoice-item-discount` — 行折扣 input；断言 0 到 100 之间且允许 0（Q-001）
- `invoice-item-tax` — 行税率 input；同上
- `invoice-item-amount` — 行小计只读展示 span；断言计算公式
- `invoice-item-remove-btn` — 删除该行按钮 button；断言最后一行不可删
- `invoice-add-item-btn` — 添加商品行按钮 button；断言达到 50 行上限时置灰
- `invoice-items-error` — 商品区错误容器 div；断言各字段校验提示
- `invoice-overall-discount` — 整单折扣 input；断言 0 到 100 之间且允许 0
- `invoice-summary` — 统计区容器 div；断言四个汇总值
- `invoice-amount-without-tax` — 未税金额只读展示 span；断言计算结果
- `invoice-total-tax` — 税额只读展示 span；同上
- `invoice-discount-amount` — 折扣额只读展示 span；同上
- `invoice-total-amount` — 应付总额只读展示 span；AC-011 断言低于 1 时阻止保存
- `invoice-category-input` — 分类 input；断言 0 到 100 字符（Q-002）
- `invoice-memo-input` — 备注 input；断言 0 到 500 字符（Q-002）
- `invoice-recurring-toggle` — 周期发票开关 switch；展开周期设置
- `invoice-recurring-frequency` — 频率 select；AC-035 断言五个频率取值
- `invoice-recurring-end-type` — 结束条件 select；断言只有两个取值（Q-011）
- `invoice-recurring-end-date` — 结束日期 input；断言选 End Date 时必填
- `invoice-save-draft-btn` — 保存草稿按钮 button；断言处理中禁用
- `invoice-create-send-btn` — 创建并发送按钮 button；AC-006 与 AC-010 断言进入 Sending 且重复点击只发一次
- `invoice-delete-btn` — 删除草稿按钮 button；AC-014 仅编辑草稿页出现
- `invoice-form-error` — 表单级错误容器 div；AC-009 断言外部调用失败时的提示且保留输入
- `invoice-delete-modal` — 删除草稿确认弹窗 div；断言确认后才删除
- `invoice-delete-confirm-btn` — 删除确认按钮 button；AC-015 断言失败时草稿仍在列表
- `invoice-same-client-draft-modal` — 同客户已有草稿的确认弹窗 div；断言 Create&Send 前出现
- `invoice-same-client-continue-btn` — 继续发送按钮 button；断言确认后才提交
- `invoice-unsaved-modal` — 未保存变更确认弹窗 div；Q-029 断言表单已修改时离开触发
- `invoice-unsaved-leave-btn` — 离开按钮 button；断言放弃修改
- `invoice-unsaved-stay-btn` — 继续编辑按钮 button；断言留在表单

### CC Recipient Modal（不占路由）

- `cc-modal` — 抄送人弹窗根容器 div；断言打开
- `cc-row` — 单个抄送人行 div，每行一个；断言增删
- `cc-email-input` — 抄送人邮箱 input；断言必填与格式校验
- `cc-email-error` — 抄送人错误容器 div；断言格式提示
- `cc-remove-btn` — 删除该行按钮 button；断言可删
- `cc-add-btn` — 添加抄送人按钮 button；断言达到 3 个上限时置灰
- `cc-save-btn` — 保存按钮 button；写回表单
- `cc-cancel-btn` — 取消按钮 button；关闭且不保存

## PAGE-007 Invoice Detail

- `invoice-detail-page` — 页面根容器 div；断言从列表进入
- `invoice-detail-status` — 状态标签 span；断言各状态显示
- `invoice-detail-items` — 商品明细容器 div；断言明细渲染
- `invoice-detail-totals` — 统计区容器 div；断言四个汇总值
- `invoice-detail-send-time` — 发送时间只读展示 span；Q-039 断言仅商户可见
- `invoice-detail-void-reason` — 作废原因容器 div；断言仅 Voided 时渲染
- `invoice-detail-error-banner` — 支付异常提示横幅 div；断言 Error 状态提示联系 super admin
- `invoice-detail-recurring` — 周期信息区容器 div；Q-013 断言显示频率与下次发送日期，非周期发票不渲染
- `recurring-discontinue-btn` — 停止周期按钮 button；仅 Active Series 出现
- `recurring-discontinue-modal` — 停止周期确认弹窗 div；断言确认后才提交
- `recurring-discontinue-confirm-btn` — 确认停止按钮 button；AC-037 断言停止后已生成发票不受影响
- `invoice-detail-duplicate-btn` — 复制按钮 button；进入复制页
- `invoice-detail-reminder-btn` — 催缴按钮 button；Pending 与 Overdue 可用
- `reminder-fallback-panel` — 本地邮件打不开时的降级面板 div；Q-033 断言含收件人、主题、正文与付款链接
- `reminder-copy-btn` — 复制内容按钮 button；供商户手动发送

## PAGE-008 Settlement List

- `settlement-list-page` — 页面根容器 div；断言导航可达
- `kpi-last-settled` — 上次结算金额卡片 div；断言可点击进入结算详情
- `kpi-settlement-pending` — 结算中金额卡片 div；断言按 Token 展示
- `settlement-search-input` — 按结算单号搜索 input；触发筛选
- `settlement-token-filter` — Token 过滤 select；按结算币种过滤
- `settlement-status-filter` — 状态过滤 select；断言只有三个取值，没有 Partial Success（Q-053）
- `settlement-created-from` — 创建时间起始 input；按创建时间过滤
- `settlement-created-to` — 创建时间结束 input；同上
- `settlement-table` — 结算表格 table；断言列与默认倒序
- `settlement-row` — 结算表格行 tr，每行一个；断言行内容
- `settlement-status-badge` — 行内状态标签 span；断言状态显示
- `settlement-empty` — 空状态容器 div；断言空态与发起结算引导
- `settlement-pagination` — 分页器 nav；断言每页 20 条与翻页
- `settlement-request-btn` — 发起结算按钮 button；进入结算申请页
- `settlement-view-detail-btn` — 行内查看详情按钮 button；进入结算详情页

## PAGE-009 Settlement Request

- `settlement-request-page` — 页面根容器 div；断言从结算列表进入
- `settlement-token-select` — 结算币种 select；Q-021 断言切换后可选发票列表随之刷新
- `settlement-wallet-select` — 钱包 select；Q-059 断言数据源是 destination 注册表
- `settlement-address-select` — 钱包地址 select；断言地址来自所选 destination 的条目
- `settlement-address-empty` — 无可用地址提示 div；EH012 断言该提示出现且下一步不可用
- `settlement-invoice-search-input` — 可结算发票搜索 input；触发筛选
- `settlement-invoice-table` — 可结算发票表格 table；断言只出 paidToken 匹配的发票
- `settlement-invoice-row` — 可结算发票行 tr，每行一个；断言行内容
- `settlement-invoice-checkbox` — 行内选择框 checkbox；勾选参与结算的发票
- `settlement-invoice-empty` — 无可结算发票提示 div；断言空态文案与返回入口
- `settlement-selected-count` — 已选发票数只读展示 span；断言随勾选变化
- `settlement-selected-amount` — 已选金额合计只读展示 span；DEC-008 断言是全额之和
- `settlement-next-btn` — 进入确认页按钮 button；AC-030 断言未选发票时禁用

## PAGE-010 Settlement Confirmation

- `settlement-confirm-page` — 页面根容器 div；断言从申请页进入
- `settlement-confirm-invoice-count` — 发票数量只读展示 span；断言与所选一致
- `settlement-confirm-amount` — 结算总金额只读展示 span；断言是全额、2 位小数
- `settlement-confirm-estimated-fee` — 预估费用只读展示 span；Q-070 断言取自提交前预估端点而非前端自算
- `settlement-confirm-fee-note` — 费用说明容器 div；断言注明实际费用可能不同
- `settlement-confirm-btn` — 提交结算按钮 button；AC-031 断言缺地址时禁用，AC-034 断言重复点击不重复创建
- `settlement-confirm-error` — 提交错误容器 div；AC-032 断言超时后保留选择并可重试
- `settlement-removed-invoices` — 被剔除发票提示容器 div；DEC-018 断言乐观锁剔除的发票必须告知商户

## PAGE-011 Settlement Detail

- `settlement-detail-page` — 页面根容器 div；断言从结算列表进入
- `settlement-detail-id` — Cobo 结算单号只读展示 span；Q-027 断言可复制，回调写入前显示占位
- `settlement-detail-status` — 结算状态标签 span；断言三种终局状态
- `settlement-detail-info` — 结算基本信息容器 div；断言创建时间、金额、地址
- `settlement-detail-invoice-search-input` — 关联发票搜索 input；触发筛选
- `settlement-detail-status-filter` — 关联发票状态过滤 select；按发票结算结果过滤
- `settlement-detail-invoices` — 关联发票表格 table；断言成功与失败发票都列出
- `settlement-detail-invoice-row` — 关联发票行 tr，每行一个；断言行内容
- `settlement-detail-pagination` — 关联发票分页器 nav；断言分页

## PAGE-013 Payer Invoice Detail

- `payer-invoice-page` — 页面根容器 div；断言通过邮件链接直达，不渲染商户端导航
- `payer-status-badge` — 发票状态标签 span；断言各状态显示
- `payer-readonly-banner` — 只读说明横幅 div；AC-021 与 AC-022 断言不可支付时说明原因
- `payer-from` — 开票方信息容器 div；断言商户名与 Logo 来自快照
- `payer-billed-to` — 付款方信息容器 div；断言客户名与邮箱
- `payer-items` — 商品明细容器 div；断言明细渲染
- `payer-totals` — 统计区容器 div；断言四个汇总值
- `payer-total-amount` — 应付总额只读展示 span；断言 2 位小数
- `payer-pay-now-btn` — 立即付款按钮 button；AC-020 断言仅 Pending 且未逾期时出现，点击后跳转 Cobo 托管页
- `payer-result-banner` — 支付回跳结果横幅 div；Q-025 断言失败、取消、超时三种情形各有提示且可原地重试
