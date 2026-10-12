# 文档导航

这些文档说明当前实现及操作方法。功能描述应与代码保持一致，流程和验证结果更新到对应文档。

开发时先阅读 [代码组织与质量检查](code-organization.md)，了解模块职责、依赖方向及 `pnpm run check`。

| 文档                                                    | 内容                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| [试卷解析、标准答案与批改流程](paper-workflow.zh-CN.md) | 全卷识别、逐题定位、裁切图文本化、可选标准答案和完整作答批改 |
| [AI 批改](ai-grading.md)                                | 标准答案前置条件、作答匹配、评分校验、版本和任务限制         |
| [AI 提供商与提示词](ai-providers-and-prompts.md)        | 六阶段模型配置、并发、凭据和提示词缓存                       |
| [当前工程与运行边界](framework.zh-CN.md)                | Web/Worker、账号权限、队列、存储和代码模块                   |
| [本地开发说明](development-setup.zh-CN.md)              | 依赖、环境变量、数据库与启动命令                             |
| [单机部署与联合备份](deployment.zh-CN.md)               | Compose、持久化、备份与恢复，以及尚未完成的部署验收          |
| [学生错题与练习](student-learning.zh-CN.md)             | 班级题套、错题、原题重练和相似题                             |
| [集成验证](ai-web-validation.md)                        | 自动检查、Web/Worker 测试和浏览器回归记录                    |
| [真实样例验证](exam-parsing-validation.md)              | examples 的结构期望、真实模型运行和评测边界                  |

试卷解析与批改的模块入口说明另见 [解析模块](../src/server/exams/README.md) 和 [批改模块](../src/server/grading/README.md)。真实模型的结构检查不代表已经测得转录、解题或评分准确率。
