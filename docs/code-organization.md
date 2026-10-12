# 代码组织与质量检查

模块按业务领域组织，文件按职责拆分。先找到业务入口，再沿显式导入阅读校验、数据访问或界面；避免把请求、数据转换和整页渲染写进同一个函数。

## 依赖方向

| 层                   | 职责                               | 依赖约束                                                         |
| -------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `src/app`            | Next.js 页面、布局与 HTTP 路由入口 | 页面组合组件；路由完成认证和输入校验后调用服务                   |
| `src/components`     | 浏览器界面、交互及请求状态         | 使用共享契约、`src/lib` 和 API；不导入服务端模块                 |
| `src/contracts`      | Zod 输入校验与跨层数据类型         | 不依赖组件、数据库或服务端实现                                   |
| `src/lib`            | 浏览器可用的转换、展示与请求工具   | 不依赖服务端模块或生成的 Prisma Client                           |
| `src/server`         | 授权、数据库、存储、AI 与业务执行  | 使用 `server-only`；按 `exams`、`grading`、`learning` 等领域分组 |
| `worker` / `scripts` | 进程与命令行入口                   | 调用业务服务，避免复制业务规则                                   |

ESLint 限制 `components`、`contracts`、`lib` 对 `@/server/**` 和 `@/generated/**` 的导入，包括类型导入。跨层数据形状放在 `contracts`，例如班级 API 的 `ClassOverview`，由服务端返回类型和组件属性共同使用。

`src/components/ui` 保留通用界面组件。领域组件放在相应子目录；顶层组件作为页面组合入口，不需要重新导出整个目录。

## 界面模块

| 入口 / 目录                                | 分工                                                      |
| ------------------------------------------ | --------------------------------------------------------- |
| `exam-workbench.tsx`                       | 查询试卷列表，组合上传与历史记录                          |
| `exams/exam-upload.tsx`                    | 文件选择、排序、上传进度与导航                            |
| `exams/exam-history.tsx`                   | 搜索与历史任务展示                                        |
| `src/lib/exam-upload.ts`                   | 文件列表校验及有进度、可取消的上传传输                    |
| `exam-result.tsx`                          | 当前页、题目和内容类型的选择，组合结果界面                |
| `exams/use-exam-result.ts`                 | 结果轮询、批改记录、取消、重试和生成答案                  |
| `exams/content-renderer.tsx`               | 文本、公式、表格和配图的统一渲染                          |
| `exams/exam-evidence.tsx`                  | 原图、题目范围、切片与材料证据                            |
| `exams/exam-question-details.tsx`          | 单题文字、标准答案和编辑入口                              |
| `ai-provider-settings.tsx` / `ai-settings` | 组合入口、提供商列表、编辑表单、默认值与 API 操作分别保存 |
| `classes.tsx` / `classes`                  | 组合入口、学生名单、批次界面与数据操作分别保存            |

请求 hook 负责数据获取和操作状态，展示组件负责 JSX。组件内部保留与自身交互直接相关的局部状态，例如历史搜索和文件拖入状态。不要为了文件行数拆出没有独立职责的碎片。

## 服务端模块

`src/server/exams/recognition-agent.ts` 管理识别会话、串行工具操作、草稿和提交。支持代码位于 `recognition/`：

| 文件                  | 职责                                               |
| --------------------- | -------------------------------------------------- |
| `instructions.ts`     | 识别提示词与版本                                   |
| `types.ts`            | 从识别契约推导的领域类型                           |
| `inspection-tools.ts` | 页面查看、图像增强、OCR 与旋转                     |
| `images.ts`           | 工具图像输出和复查证据图                           |
| `validation.ts`       | Markdown、区域、分值及提交完整性校验               |
| `assemble.ts`         | 将识别草稿适配为 `DigitalExam`，生成切片与配图产物 |

`src/server/grading/service.ts` 组织批改任务与进度；`model-budget.ts` 处理并发调用预算和用量累计；`assessment.ts` 校验逐题评分、作答来源及小问覆盖；`score.ts` 负责数值校验和总分汇总。任务持久化及队列恢复仍由 `tasks.ts` 处理。

新增规则放入负责该规则的模块。提示词、输入契约、数值计算和文件写入各有自己的修改原因，不应混在界面或 HTTP 路由里。

## 格式与检查

Prettier 负责支持的 TypeScript、JavaScript、CSS、JSON、YAML 和 Markdown 文件，统一双引号、分号、两空格缩进、100 列换行和 LF。`.editorconfig` 同步编辑器的缩进与换行；Python 保留四空格缩进。

生成代码、锁文件、迁移记录、本地工具、存储产物和技能文件由 `.prettierignore` 排除。ESLint 使用 Next.js Core Web Vitals 与 TypeScript 规则、严格相等和变量声明规则；`eslint-config-prettier` 放在最后，关闭与 Prettier 冲突的格式规则。`lint` 遇到警告也会失败。

```bash
pnpm run format        # 修改支持文件的格式
pnpm run format:check  # 只检查格式
pnpm run lint         # 只检查代码规则
pnpm run lint:fix     # 修复可自动处理的问题
pnpm run check        # 格式、ESLint、TypeScript 与单元/回归测试
pnpm run build        # 另行验证生产构建
```

在编辑器中启用 Prettier 的保存时格式化即可；检查脚本不依赖某个编辑器。提交前运行 `check`，修改页面或服务依赖时同时运行 `build`。测试应覆盖行为边界，例如上传失败时保留文件、污染图不作为干净配图展示、模型失败仍累计用量，而不是重复函数实现。
