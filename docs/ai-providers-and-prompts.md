# AI 提供商、阶段模型与提示词

管理员在 `/admin/ai` 保存提供商名称、API 协议、base URL、API key 和模型 ID。支持 Responses、Chat Completions 兼容协议、Anthropic Messages 与 Google Generative AI。一个配置对应一个接口和模型；同一供应商的不同模型可以保存为多条配置。

新账号默认角色为 `USER`。管理员由受控数据库操作授予 `ADMIN`，权限规则见 [工程底座](framework.zh-CN.md#认证与权限)。

## 独立配置识别、标准答案与批改

| 配置键        | 职责                                       | 输入与输出                         |
| ------------- | ------------------------------------------ | ---------------------------------- |
| `recognition` | 自主选择工具识别试卷、材料、作答和参考答案 | PDF/图片页面 → Markdown/LaTeX JSON |
| `solution`    | 整理或生成标准答案与解析                   | 电子题目、干净配图、已提取参考答案 |
| `grading`     | 每题匹配作答并评分                         | 完整作答文档、本题及标准答案       |

识别 Agent 使用统一的任务说明，不固定工具执行顺序。它需要视觉、多图、工具调用以及 Responses/对应协议支持。模型请求使用 generate 避免网关流中断，工具生命周期回调实时展示操作。工具选择使用 required，Agent 自行选择任意工具，并通过 finish 的结果校验提交，避免只输出状态文字就结束。DeepSeek/Qwen 的识别调用关闭思考模式以支持此配置，求解和批改配置不变。网页展示实际消息、工具参数、执行结果与图像预览。

识别配置按 `recognition`、旧 `inventory`、旧 `exam` 的优先级选择；标准答案保留 `solution`、`grading`、`exam` 的默认顺序。旧 localization/transcription/answer_extraction 设置不再拆分识别过程。已保存的旧快照仍可读取。

“测试连接”检查图片输入和 JSON 输出，不证明工具调用兼容性或试卷准确率，应再运行实际识别任务。

## 输出、并发与超时

协议与提示词预设独立设置。例如使用 Chat Completions 兼容协议的 Kimi 模型仍可选择 Kimi 预设。提供商配置包含输出 token 上限、调用超时和最大并发数。

最大并发数范围为 1–32，默认 3。一个 Worker 进程内，相同供应商的识别、求解、批改和练习请求共享调度器；不同供应商独立调度。单次调用超时从取得槽位后计算。多个 Worker 各自限流，当前没有跨进程的供应商总额度。

Chat Completions 默认不启用原生 JSON Schema，可在高级设置中开启兼容接口支持的结构化输出。关闭时，程序将当前阶段的 JSON Schema 同时写入提示词。所有输出仍须通过 Zod 和业务校验。合法的 Markdown JSON 代码块先解包；格式错误仅在预算内尝试一次序列化修复。

试卷任务提交时冻结识别、标准答案和批改模型配置及生成答案选项，批改任务提交时冻结批改模型配置。修改或删除后台提供商不会改变已经提交的配置快照。

## 提示词与缓存

OpenAI、Gemini、Anthropic、DeepSeek 和 Kimi 五套预设由应用维护，具体来源链接记录在 [预设定义](../src/contracts/prompt-presets.ts) 中。预设组织角色、证据规则和阶段输出约束，实际职责由阶段提示词定义。识别 Agent 使用简洁的统一目标与粗略指导，输出 Markdown/LaTeX JSON；求解与批改保留独立规则。

公共证据规则构成稳定 system 前缀，当前阶段及 Schema 跟随其后；题目、图片、裁切图和作答属于该请求的输入。Anthropic 的缓存标记放在包含当前阶段和 Schema 的 system 块末尾。调用记录累计 API 返回的缓存读写 token；兼容接口可读取 DeepSeek 的 `prompt_cache_hit_tokens`。实际缓存命中由接口返回，无法仅凭相同提示词保证。

## 凭据与上传边界

API key 使用 AES-256-GCM 加密保存，`PROVIDER_KEY_ENCRYPTION_KEY` 至少 32 字符，Web 与 Worker 必须一致并在重新部署时保留。密钥不回传浏览器；编辑配置时留空保留旧密钥。任务配置快照同样保存加密凭据。

Web 与 Worker 共享 PostgreSQL 和 `STORAGE_ROOT`。用户原件和产物位于私有目录，通过授权 API 访问。上传限制为单文件 40 MB、每次 20 个文件、合计 100 MB，解析最多 50 页；普通上传每用户最多同时 3 个识别任务。业务任务记录与入队在同一数据库事务中写入。

## 启动与验证

```bash
pnpm run db:generate
pnpm run db:deploy
pnpm run dev:all
```

网页任务使用数据库配置。CLI 可用 `--configured` 读取相同的阶段配置；不带该参数时使用原有 DeepSeek 环境变量适配器。命令和费用边界见 [真实样例验证](exam-parsing-validation.md)。

本地集成检查使用 `pnpm run test:exam-web`。脚本创建临时账号和提供商，完成后恢复原识别与批改默认设置并清理生成文件；使用 `--keep` 保留的测试数据可用 `pnpm run test:exam-web --cleanup` 清理。
