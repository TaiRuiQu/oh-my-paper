# 当前流程的集成验证

适用版本：`recognition-agent-2-markdown`、`exam-grading-3-full-answer-agent`。本文保留可复现的检查方式与流程重写时的回归记录。

## 自动检查

```bash
pnpm run doctor
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

项目依赖检查必须使用 `pnpm run doctor`。`pnpm doctor` 是包管理器自身的命令。

2026-10-12 本次重写的单元测试 95 项通过，类型检查、lint、doctor 和生产构建通过。单元测试覆盖自主工具顺序、Markdown/LaTeX 忠实保存、跨页裁切、材料顺序、工具上下文保留/压缩、失败重试与原件哈希校验、逐项答案、完整作答匹配、评分边界、模型调用预算和证据资产，也检查漏存逐页作答及材料超出题目裁切区域时拒绝提交。

## Web 与 Worker 集成

先准备数据库和模型配置，再启动应用：

```bash
pnpm run db:generate
pnpm run db:deploy
pnpm run dev:all
```

在另一个终端运行：

```bash
pnpm run test:integration
pnpm run test:queue
pnpm run test:exam-web
pnpm run test:learning-web
```

这些命令使用临时账号、队列或本地模拟模型。`test:exam-web` 检查真实 HTTP 接口、持久 Worker 和文件存储，覆盖：

- 损坏文件失败后仍继续消费后续任务。
- 管理员权限、用户隔离、原图和切片下载授权。
- 识别 Agent/标准答案模型配置快照、题套固定版本、答题卡作答解析和保存答案复用。
- 关闭生成时跳过无参考答案的求解；缺少标准答案时拒绝创建批改任务。
- 保存编辑后补生成答案，复用当前题目而不重新识别原件。
- 非文字作答的资产匹配、报告图片权限及 HTML 导出。

Agent 重写期间 `test:exam-web` 已通过，覆盖实际 SDK 工具调用、校验错误反馈、增量操作记录、授权预览、模板复用与批改交接。真实数学 PDF 已通过浏览器上传并得到 19 道题/2 张配图；桌面和手机页面的工具展开、JSON 输入/结果、配图预览与 LaTeX 图片正常显示，没有横向溢出。最近一次浏览器可访问性检查没有 violation。`test:integration`、`test:queue`、`test:learning-web` 均已运行通过。

脚本默认清理自己创建的数据。使用 `pnpm run test:exam-web --keep` 保留的 fixture，验证结束后运行 `pnpm run test:exam-web --cleanup`。测试会临时切换提供商，运行期间应避免提交其他业务任务。

## 真实模型与结果边界

`pnpm run test:exam-web --live` 会使用 DeepSeek 环境变量和合成试卷，产生 API 费用；它用于验证接口与流程。`test:grading-web` 依赖先运行 `test:exam-web --live --keep` 留下的 fixture，也会调用真实模型。

`examples` 中的真实文件通过 `eval:exams` 检查，命令与当前限制见 [真实样例验证](exam-parsing-validation.md)。模型协议、流程或结构检查通过，都不能直接证明题目文字、公式、标准答案或评分正确率。

流程重写时的私有本地汇总为 `tmp/workflow-review/validation-summary.json`，记录了不同修复阶段的样例结果。完整样例批次早于后续修复，部分后续检查仅覆盖单个样例或阶段；这些结果不能合并为最终全样例通过率。

本次 Agent 的证据汇总保存于忽略 Git 的 `storage/exam-evals/recognition-agent-acceptance-audit/report.json`。生物照片包含来源词语、印刷空格和跨栏续题锚点；化学、生物和物理检查逐题学生作答关联；物理还检查每道题的可读参考答案，不能以整页截图替代。

API 恢复后，DeepSeek/Qwen 均通过真实的工具返回图片读码探测。DeepSeek 的六样例运行中，数学和语文结构检查通过，其他样例仍有漏题、误建题或步数用尽；协议连接成功不代表所有模型具有相同的识别质量。配置中的 gpt-6.1-sol 用于更完整的来源复核。识别通过工具自主提交，单文档上限为 100 个模型步骤；DeepSeek/Qwen 的识别请求关闭思考模式以支持 required 工具选择，求解和批改配置不变。

gpt-6.1-sol 的完成结果覆盖六份文件的全部73个预期题号，原始结构检查均通过；生物的来源词语、空格和续题锚点通过。严格附加检查仍揭露化学学生答案/教师纠正混淆和物理作答/参考答案关联不完整。依据用户“大部分题目识别正确即可，不要求100%”的验收要求，停止继续优化模型输出；保留这些失败检查及不完整实验，不将其计为通过。逐字公式准确率未测量。

Docker/Compose 构建、生产部署和数据库与文件的联合恢复尚未完成验收，状态见 [部署说明](deployment.zh-CN.md)。
