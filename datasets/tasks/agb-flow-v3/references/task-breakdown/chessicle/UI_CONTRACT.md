# UI Contract

下游必须渲染的锚点。原型（`docs/AI Chess Analysis Tool/`，`Q-029` 裁定为准绳）里
**一处 data-testid 都没有**，所以这份文件不是把 DOM 抄一遍 —— 它是新增的契约。

无障碍基线 WCAG 2.1 AA（`Q-016`）：每个锚点的可见符号与 aria-label 必须一致，
键盘可达，焦点可见。**着法分类不许只靠颜色区分** —— 符号表在 PAGE-007 一节。

棋子图集固定用 alpha piece set（`Q-004`）。

## PAGE-001 登录 / 注册（`/login`）

- `login-email-input` — 邮箱输入框 input；登录用例填写邮箱
- `login-birth-year-input` — 出生年输入框 input；注册时填写，Q-031 的年龄门读它
- `login-request-code-btn` — 提交按钮 button；发起发码请求
- `login-code-input` — 验证码输入框 input；填写 6 位登录码
- `login-verify-btn` — 提交按钮 button；提交验证码建立会话
- `login-error` — 错误提示容器 div；登录失败用例断言服务端返回的 code 与 message
- `login-rate-limited` — 限流提示容器 div；断言发码超过 5 次/小时后的提示

## PAGE-002 家长同意（`/consent`）

- `consent-parent-email-input` — 家长邮箱输入框 input；填写家长邮箱
- `consent-request-btn` — 提交按钮 button；请求向家长发送验证码
- `consent-code-input` — 验证码输入框 input；家长填写 6 位码
- `consent-confirm-btn` — 提交按钮 button；确认同意
- `consent-resend-btn` — 重发按钮 button；EH005 断言重发后旧码立即失效
- `consent-expired-notice` — 过期提示容器 div；断言 2 分钟过期后的文案
- `consent-declined-notice` — 拒绝提示容器 div；EH006 断言「家长已拒绝」出现在删号之前
- `consent-suspended-notice` — 挂起提示容器 div；Q-008 断言账号挂起后可继续

## PAGE-003 我的对局（`/`）

- `dashboard-start-analysis-btn` — 主操作按钮 button；跳转到上传页
- `dashboard-opponent-prep-btn` — 导航按钮 button；跳转到对手准备页
- `dashboard-game-list` — 列表容器 ul；断言列表渲染与空态切换
- `dashboard-game-row` — 单条对局行 li；点击进入报告，同一列表内重复出现
- `dashboard-empty-state` — 空态容器 div；断言零对局时的提示
- `dashboard-load-more-btn` — 加载更多按钮 button；DEC-007 断言 cursor 分页

## PAGE-004 上传记谱纸（`/analyze/upload`）

- `upload-photo-input` — 文件选择 input；选择或拍摄记谱纸照片
- `upload-submit-btn` — 提交按钮 button；发起上传
- `upload-stay-warning` — 警告容器 div；AC-010 断言「不要离开此页」在提交前可见
- `upload-retake-notice` — 重拍提示容器 div；EH001 断言可读率低于 80% 的文案
- `upload-not-scoresheet-notice` — 非记谱纸提示容器 div；Q-005 断言与重拍同状态但文案不同

## PAGE-005 上传与预扫进度（`/analyze/processing`）

- `progress-stay-warning` — 警告容器 div；AC-010 断言标签页失焦时警告仍然可见
- `progress-stage-label` — 阶段文字 span；断言 uploading/prescanning/reconstructing 的切换
- `progress-bar` — 进度条 div；断言百分比推进
- `progress-slow-network-notice` — 慢速提示容器 div；Q-013 断言超过 30 秒改文案而不失败
- `progress-abandoned-notice` — 丢失提示容器 div；EH004 断言「扫描已丢失，请重新开始」

## PAGE-006 歧义着法确认（`/analyze/confirm`）

布局取原型的 `ocr` 步骤（`Q-014`）。

- `confirm-ambiguity-list` — 列表容器 ul；断言不确定半步的条数
- `confirm-ambiguity-row` — 单个半步行 li；每个歧义半步一行
- `confirm-candidate-btn` — 候选着法按钮 button；从候选中选择一个
- `confirm-manual-input` — 手工输入框 input；候选都不对时自行填写 SAN
- `confirm-repair-badge` — 修复标记 span；TRD §4.1 断言 beam 插入/删除的半步被显式标出
- `confirm-submit-btn` — 提交按钮 button；确认全部歧义并开始分析

## PAGE-007 分析报告（`/games/:gameId`）

着法分类的第二重编码（`Q-016`，取自原型的 `CLS_SYM`）：Brilliant `!!` · Great `!` ·
Best 星号 · Excellent 对勾 · Good 无符号 · Inaccuracy `?!` · Mistake `?` ·
Miss 无符号 · Blunder `??`。Good 与 Miss 无符号，所以它们的 aria-label
必须带完整分类名。

- `report-summary-strategic` — 战略失误摘要容器 div；AC-005 断言败因出现在报告顶部
- `report-accuracy` — 准确率数值 span；断言整体准确率
- `report-turning-points` — 转折点列表 ul；AC-005 断言关键转折点
- `report-recurring-themes` — 复发主题列表 ul；AC-005 断言复发主题
- `report-move-list` — 着法列表容器 ol；断言逐步渲染
- `report-move-row` — 单步着法行 li；点击展开该步解释
- `report-move-class-badge` — 分类标记 span；断言颜色之外的符号与 aria-label
- `report-move-explanation` — 解释文字容器 div；AC-004 断言首条解释 5 秒内出现
- `report-move-explanation-loading` — 解释加载态 div；AC-004 断言未完成时的加载态
- `report-study-list` — 学习推荐列表 ul；AC-006 断言推荐挂在相关着法上
- `report-study-link` — 单条推荐外链 a；DEC-010 断言 href 落在白名单域名内
- `report-study-empty` — 推荐空态容器 div；DEC-010 断言宁可为空也不给未审链接
- `report-partial-banner` — 局部报告横幅 div；Q-007 断言「前 N 步已分析」的文案
- `report-retry-btn` — 重试按钮 button；EH003 重新发起分析
- `report-finish-tournament-btn` — 导航按钮 button；跳转到局数填写页
- `report-review-prompt` — 评分弹层容器 div；AC-009 断言看完报告后弹出
- `report-review-star` — 单颗星按钮 button；选择 1 到 5 星
- `report-review-submit-btn` — 提交按钮 button；提交站内评分

## PAGE-008 本次比赛局数（`/analyze/tournament-count`）

- `checkin-games-played-input` — 数字输入框 input；填写这个周末下了几盘
- `checkin-submit-btn` — 提交按钮 button；提交主指标的分母

## PAGE-009 对手准备（`/prep`）

- `prep-name-input` — 姓名输入框 input；必填，填写对手姓名
- `prep-rating-input` — 评分输入框 input；Q-001 断言留空也能提交
- `prep-federation-select` — 联合会下拉 select；可选，USCF 或 FIDE
- `prep-search-btn` — 提交按钮 button；发起公开资料检索
- `prep-candidate-list` — 候选列表容器 ul；EH009 断言同名多人时的消歧列表
- `prep-candidate-row` — 单个候选行 li；带评分、联合会、最近活动
- `prep-no-information` — 无信息容器 div；Q-006 断言全不匹配时报「无信息」而不是猜
- `prep-openings-white` — 执白开局列表 ul；AC-007 断言开局倾向
- `prep-openings-black` — 执黑开局列表 ul；AC-007 断言开局倾向
- `prep-suggested-lines` — 准备变例列表 ul；AC-007 断言建议的准备线路
- `prep-sources-queried` — 来源状态列表 ul；DEC-011 断言哪个源没到被显式标出

## PAGE-010 浏览器不支持（`/unsupported`）

- `unsupported-notice` — 提示容器 div；EH007 断言引导改用 Chrome 或 Safari 的文案

## PAGE-011 家长撤回同意（`/consent/revoke`）

- `revoke-confirm-btn` — 确认按钮 button；Q-011 触发与 EH006 同一条删除流程
- `revoke-done-notice` — 完成提示容器 div；断言撤回后的确认文案
- `revoke-invalid-link` — 无效链接容器 div；DEC-004 断言签名令牌无效或已用过
