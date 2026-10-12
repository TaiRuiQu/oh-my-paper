# 当前流程的集成验证

适用版本：`exam-pipeline-4-crop-agents`、`exam-grading-3-full-answer-agent`。本文保留可复现的检查方式与流程重写时的回归记录。

## 自动检查

```bash
pnpm run doctor
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

项目依赖检查必须使用 `pnpm run doctor`。`pnpm doctor` 是包管理器自身的命令。

2026-10-12 流程重写完成时，单元测试 93 项通过，类型检查、lint 和生产构建通过。单元测试覆盖阶段隔离、跨页裁切、材料顺序、逐项答案、完整作答匹配、评分边界、模型调用预算和证据资产。

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
- 六阶段模型配置快照、题套固定版本、答题卡作答解析和保存答案复用。
- 关闭生成时跳过无参考答案的求解；缺少标准答案时拒绝创建批改任务。
- 保存编辑后补生成答案，复用当前题目而不重新识别原件。
- 非文字作答的资产匹配、报告图片权限及 HTML 导出。

流程重写完成时 `test:exam-web` 已通过；桌面和手机浏览器检查了上传、模型设置及批改报告，非文字作答图片可显示，所检查页面没有横向溢出。其余命令可按上面的方式单独复现。

脚本默认清理自己创建的数据。使用 `pnpm run test:exam-web --keep` 保留的 fixture，验证结束后运行 `pnpm run test:exam-web --cleanup`。测试会临时切换提供商，运行期间应避免提交其他业务任务。

## 真实模型与结果边界

`pnpm run test:exam-web --live` 会使用 DeepSeek 环境变量和合成试卷，产生 API 费用；它用于验证接口与流程。`test:grading-web` 依赖先运行 `test:exam-web --live --keep` 留下的 fixture，也会调用真实模型。

`examples` 中的真实文件通过 `eval:exams` 检查，命令与当前限制见 [真实样例验证](exam-parsing-validation.md)。模型协议、流程或结构检查通过，都不能直接证明题目文字、公式、标准答案或评分正确率。

流程重写时的私有本地汇总为 `tmp/workflow-review/validation-summary.json`，记录了不同修复阶段的样例结果。完整样例批次早于后续修复，部分后续检查仅覆盖单个样例或阶段；这些结果不能合并为最终全样例通过率。

Docker/Compose 构建、生产部署和数据库与文件的联合恢复尚未完成验收，状态见 [部署说明](deployment.zh-CN.md)。
