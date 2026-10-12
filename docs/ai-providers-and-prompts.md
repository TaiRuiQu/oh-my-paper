# AI 提供商、阶段模型与提示词

管理员在 `/admin/ai` 保存提供商名称、API 协议、base URL、API key 和模型 ID。支持 Responses、Chat Completions 兼容协议、Anthropic Messages 与 Google Generative AI。一个配置对应一个接口和模型；同一供应商的不同模型可以保存为多条配置。

新账号默认角色为 `USER`。管理员由受控数据库操作授予 `ADMIN`，权限规则见 [工程底座](framework.zh-CN.md#认证与权限)。

## 六个阶段分别选模型

保存配置后，在阶段模型设置中分别选择：

| 配置键 | 阶段职责 | 所需输入 |
| --- | --- | --- |
| `inventory` | 全卷题目识别，确定题数、分值与页码 | 所有正向页面 |
| `localization` | 每题的整题框与非文字材料框 | 本题涉及的完整页面 |
| `transcription` | 裁切图文本化 Agent | 本题裁切图、材料目录 |
| `solution` | 整理或生成逐项标准答案与解析 | 电子题目、干净材料图、已提取参考答案 |
| `answer_extraction` | 作答定位与裁切图文本化 Agent | 作答页、题套结构、有序作答裁切图 |
| `grading` | 每题独立匹配作答并评分 | 完整作答文档、图像、本题及标准答案 |

旧的“用于识别”设置 `exam` 保留为默认配置。未单独选择的阶段使用它；`solution` 优先依次使用 `solution`、`grading`、`exam`。配置可分别选择，也可共享同一个模型。

视觉输入阶段需要模型支持图片和多图输入；文本化、作答解析与批改 Agent 还需要工具调用能力。“测试连接”检查图片输入和 JSON 输出，不能证明工具调用兼容或试卷准确率。应通过实际阶段请求确认所选接口可用。

## 输出、并发与超时

协议与提示词预设独立设置。例如使用 Chat Completions 兼容协议的 Kimi 模型仍可选择 Kimi 预设。提供商配置包含输出 token 上限、调用超时和最大并发数。

最大并发数范围为 1–32，默认 3。一个 Worker 进程内，相同供应商的识别、求解、批改和练习请求共享调度器；不同供应商独立调度。单次调用超时从取得槽位后计算。多个 Worker 各自限流，当前没有跨进程的供应商总额度。

Chat Completions 默认不启用原生 JSON Schema，可在高级设置中开启兼容接口支持的结构化输出。关闭时，程序将当前阶段的 JSON Schema 同时写入提示词。所有输出仍须通过 Zod 和业务校验。合法的 Markdown JSON 代码块先解包；格式错误仅在预算内尝试一次序列化修复。

试卷任务提交时冻结六阶段模型配置及生成答案选项，批改任务提交时冻结批改模型配置。修改或删除后台提供商不会改变已经提交的配置快照。

## 提示词与缓存

OpenAI、Gemini、Anthropic、DeepSeek 和 Kimi 五套预设由应用维护，具体来源链接记录在 [预设定义](../src/contracts/prompt-presets.ts) 中。预设组织角色、证据规则和阶段输出约束，实际职责由阶段提示词定义。定位阶段只输出框，文本化阶段忠实转录，求解与批改各使用独立任务规则。

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
