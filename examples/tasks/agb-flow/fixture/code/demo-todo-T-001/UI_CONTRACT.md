# UI Contract

命名规则与「只能加不能删改」的约束见知识包 `stack-conventions-react`
的「`data-testid` 契约（HARD RULE）」一节；本文件只声明下游必须实现的锚点，
不重复那一节的规则细节。可重复出现的元素（列表行、卡片、按钮组）标注了
配合使用的数据属性，用于在 e2e 中定位具体实例。

## PAGE-001 任务看板

- `current-member-select` — 当前成员 `<select>`；e2e 选择当前成员触发高亮（IC-01）
- `new-task-button` — 新建任务 `<button>`；e2e 点击导航到 `/tasks/new`（IC-02）
- `assignee-filter-select` — 负责人筛选 `<select>`；e2e 选择后断言仅显示该负责人的卡片（IC-03, AC-11）
- `show-completed-toggle` — 显示已完成开关；e2e 切换后断言已完成列出现/消失（IC-04, AC-08）
- `members-link` — 成员管理入口 `<a>`；e2e 点击导航到 `/members`（IC-07）
- `board-loading` — 三列骨架容器；e2e 断言加载态
- `board-empty` — 空态提示容器（文案「还没有任务，点击「新建任务」开始」）；e2e 断言空态（AC-09）
- `board-error` — 错误条容器；e2e 断言后端返回的失败原因
- `todo-column` — 待办列容器；e2e 统计待办列卡片数（AC-02）
- `in-progress-column` — 进行中列容器；e2e 断言卡片移入/移出（AC-07）
- `done-column` — 已完成列容器；e2e 断言默认不渲染（AC-08），开关开启后渲染
- `task-card` — 任务卡片，配合 `data-task-id` 定位具体任务；e2e 点击导航到详情页（IC-05），逐张检查负责人（AC-11）
- `task-card-advance-button` — 卡片内状态推进按钮，配合 `data-task-id`；e2e 点击推进状态，断言 loading/成功移列/失败归位（IC-06, AC-07）
- `workload-item` — 侧栏成员工作量行，配合 `data-member-id`；e2e 比对工作量数字（RULE-01, AC-10）

## PAGE-002 新建任务

- `new-task-title-input` — 标题 `<input>`；e2e 填写标题，失焦触发必填校验（IC-08, AC-01）
- `new-task-title-error` — 标题下方内联错误容器（文案「标题必填」）；e2e 断言校验提示（AC-01）
- `new-task-description-textarea` — 描述 `<textarea>`；e2e 填写描述（IC-09）
- `new-task-assignee-select` — 负责人 `<select>`（含「未分配」）；e2e 选择负责人，断言选项集合等于名册加「未分配」（IC-10, AC-04）
- `new-task-submit-button` — 创建 `<button>`；e2e 提交创建，标题为空时断言 `disabled`，提交中断言 loading（IC-11, AC-01）
- `new-task-cancel-button` — 取消 `<button>`；e2e 点击导航回 `/`（IC-12）
- `new-task-error` — 顶部错误提示容器；e2e 模拟提交失败，断言输入保留且显示失败原因（AC-03）

## PAGE-003 任务详情

- `task-detail-back-link` — 返回看板 `<a>`；e2e 点击导航回 `/`（IC-17）
- `task-detail-status-badge` — 当前状态徽标；e2e 断言转移后徽标更新（IC-16）
- `task-detail-not-found` — 任务不存在提示容器（文案「任务不存在」，含返回看板链接）；e2e 用无效 taskId 断言 error 态
- `task-detail-title-input` — 标题内联输入；e2e 输入后失焦，断言已保存/失败回滚（IC-13）
- `task-detail-description-textarea` — 描述内联文本域；e2e 输入后失焦，断言已保存/失败回滚（IC-14）
- `task-detail-assignee-select` — 负责人 `<select>`；e2e 改派后断言立即保存与工作量联动（IC-15, AC-05）
- `task-detail-saving-indicator` — 保存中/已保存标记；e2e 断言保存中字段禁用、成功后出现已保存标记
- `task-detail-transition-button` — 状态转移按钮，配合 `data-transition-to`；e2e 清点当前状态下渲染的按钮数量（AC-06），点击执行转移（IC-16, AC-07）

## PAGE-004 成员管理

- `members-back-link` — 返回看板 `<a>`；e2e 点击导航回 `/`（IC-21）
- `members-loading` — 列表骨架容器；e2e 断言加载态
- `members-empty` — 空态提示容器（文案「还没有成员，先添加一位」）；e2e 断言空态
- `members-error` — 错误提示容器；e2e 断言读写失败原因
- `member-row` — 成员行，配合 `data-member-id`；e2e 清点名册条数（AC-12, AC-13）
- `member-remove-button` — 行内移除 `<button>`，配合 `data-member-id`；e2e 点击弹出确认（IC-20）
- `member-remove-confirm-button` — 移除确认弹窗中的确认 `<button>`；e2e 确认移除，断言该成员消失且其任务负责人变为未分配（IC-20, AC-13）
- `new-member-name-input` — 新成员姓名 `<input>`；e2e 输入姓名，回车等价于点击添加成员（IC-18）
- `new-member-name-error` — 重名内联错误容器（文案「该成员已存在」）；e2e 重复添加同名成员两次断言（AC-12）
- `add-member-button` — 添加成员 `<button>`；e2e 点击添加，断言 loading 与成功后列表更新、输入框清空（IC-19）
