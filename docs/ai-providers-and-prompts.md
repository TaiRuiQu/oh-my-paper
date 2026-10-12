# AI 提供商与提示词

管理员登录后访问 `/admin/ai`，填写提供商名称、API 协议、完整 base URL、API key 和模型 ID。支持 Responses、Chat Completions 兼容协议、Anthropic Messages 和 Google Generative AI。模型必须支持图片输入；“测试连接”检查图片输入与 JSON 输出，不能衡量试卷准确率。

新账号默认角色为 `USER`。通过受控数据库操作将指定管理员账号的 `role` 设置为 `ADMIN`，才会显示 AI 设置入口；详见[账号与管理员权限](framework.zh-CN.md)。测试不会把真实账号自动提升为管理员。

保存后点击“用于识别”或“用于批改”，两种任务可选不同模型。未单独配置批改模型时使用识别模型。协议和提示词预设独立配置，例如 Kimi 模型使用 Chat Completions 兼容协议时仍选择 Kimi 提示词。Chat Completions 默认使用 JSON Object；接口支持 JSON Schema 时可在高级设置中启用。输出 token 数和调用超时按模型限制调整。网页任务使用数据库配置，CLI 原有 DeepSeek 环境变量入口仍可使用。

API key 以 AES-256-GCM 加密保存。`PROVIDER_KEY_ENCRYPTION_KEY` 必须是至少 32 字符的随机秘密；Web 与 Worker 使用同一值，重新部署时保留该值。密钥不回传浏览器。编辑时留空保留旧密钥。任务保存加密配置快照，修改或删除提供商不会改变已提交任务。

## 官方依据与应用预设

以下为应用自主编写的试卷提示词，采用官方推荐结构，并非官方发布的试卷识别提示词，也不声称已经提升准确率。

| 预设 | 应用方式 | 官方依据 |
| --- | --- | --- |
| OpenAI | 角色、固定规则、任务和输出约束分区 | [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering) |
| Gemini | 直接指令、明确图像用途、结构化输出和最后检查 | [Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies) |
| Anthropic | XML 分隔固定规则、阶段任务、格式示例 | [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) |
| DeepSeek | 明确 JSON、结构示例、完整输出与转义 | [JSON Output](https://api-docs.deepseek.com/guides/json_mode/) |
| Kimi | 中文角色、清晰分步指令、参考证据和缺失信息处理 | [Prompt Best Practices](https://platform.kimi.ai/docs/guide/prompt-best-practice) |

每套预设共享相同的业务边界：忠实转录、不解题、不补造缺失题目；学生作答、教师批注与参考答案独立保存。预设包围每个识别阶段，包括方向、页面清单、内容识别、独立核对和配图边界检查。结果记录模型与完整提示词版本。

## 前缀与缓存

重复最多的角色、证据边界和转录规则组成固定前缀；阶段名称、阶段示例及 schema 在其后，页面、图像、PDF 文本、草稿及前后页上下文放在 user 消息中。不在固定前缀插入时间、用户 ID 或试卷名称。识别与核对使用相同公共前缀，识别的完整原图在核对请求中也保留原有顺序。缓存不通过删减必要证据来实现。

DeepSeek 采用[自动前缀缓存](https://api-docs.deepseek.com/guides/kv_cache/)；OpenAI 和 Gemini 可由服务商使用隐式缓存。Anthropic 在稳定 system 块上设置 `cacheControl: { type: 'ephemeral' }`，阶段块放在其后，依据[官方缓存指南](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。不同 schema、模型、服务商缓存门槛及过期时间仍可能造成缓存未命中。

调用返回的 `inputTokenDetails.cacheReadTokens` / `cacheWriteTokens` 累计到核对记录中。DeepSeek 兼容接口可读取其 `prompt_cache_hit_tokens`。这些数值来自 API 返回值，不把“同前缀”直接当成实际命中，也不根据 token 数臆算费用。

## 启动与验证

```bash
pnpm db:generate
pnpm db:deploy
pnpm dev:all
node --conditions=react-server --import tsx scripts/test-exam-web.ts
# 使用 .env 中的 DeepSeek key 执行真实图片识别测试（产生 API 费用）
node --conditions=react-server --import tsx scripts/test-exam-web.ts --live
```

Web 与 Worker 共享 PostgreSQL 和 `STORAGE_ROOT`。上传存储在私有目录，API 验证当前用户拥有试卷后才返回原图或导出文件。上传流限制为单文件 40 MB、20 个文件、总计 100 MB；解析最多 50 页。每用户最多 3 个同时识别任务。任务记录和入队写入同一数据库事务。

集成测试创建临时账号与提供商，完成后恢复原识别配置并清理其生成文件；`--keep` 可为浏览器验证保留临时数据，使用 `pnpm test:exam-web --cleanup` 清理。真实测试使用明确标注的合成试卷，不是准确率基准测试。
