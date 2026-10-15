# Agent 工具与沙箱

平台自主 Agent 由 AI SDK `ToolLoopAgent` 根据任务和工具结果自主决定下一步。工具入口为 `src/server/platform/ai/features.ts`，不预设模型必须执行的固定流程。

## 工具清单

自主 Agent 共同拥有 `python`、`shell`、`skip_questions`、`finish` 与 `report_failure`。其余工具负责读取受权业务对象或提交经过验证的业务结果：

| Agent                     | 业务工具                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| 图片导入 `IMPORT`         | `record_source_inventory`、`propose_question`                                                 |
| 答案与知识点补全 `ENRICH` | `read_question`、`propose_enrichment`                                                         |
| 智能组卷 `ASSEMBLE`       | `search_questions`、`read_question`、`propose_paper`                                          |
| 答题卡 `TEMPLATE`         | `read_paper`、`read_paper_question`、`generate_layout`、`render_template`、`propose_template` |
| 练习册批改 `GRADE`        | `read_answer`、`record_answers`、`propose_grade`                                              |
| 巩固练习 `RECOMMEND`      | `read_learning`、`search_candidates`、`read_candidate`、`propose_recommendations`             |

`generate_layout` 提供现有答题卡引擎的可编辑初稿，模型也可自行计算布局后提交。业务提交工具保留账号权限、真实题目 ID、题型完整性、评分上限、多人评阅和事务校验；沙箱无法直接连接数据库或绕过这些规则。

TEMPLATE 使用专用提示词，要求按题意、解答步骤、作图及作文篇幅分配书写空间，按需读取完整题目，核对综合题小问安排、分页与留白，并保留扫描定位与考号识别约束。`render_template` 接受完整 `layout` 和 `pages`（默认 `[1]`，每次 1–3 个不同页码），复用编辑器及打印的 `renderCardSvg`，直接返回真实 JPEG 像素；单图长边最多 1800px、最多 512 KiB。工具只读取当前试卷授权的配图并在本地内嵌，不访问远程地址，不保存模板或新增配图资产。草稿页码编码不作为正式扫描凭证。模型必须查看最终布局的全部页面后才能 `propose_template`；预览证据与整份布局绑定，修改布局后须重新预览全部页。程序能验证预览覆盖，具体书写空间和视觉效果仍由模型判断。

## 评分任务分配

`GRADE` 由程序按上传顺序、每人页数及 `studentIds` 分配，不再启动学生识别、页面排序或考试逐题评分 Agent。练习册每人一个自主 Agent；考试按模板裁剪后，每份答卷仅调用一次 `generateText` + `Output.object`，直接传入全部题目、答案、评分标准、作答图与题图，返回逐题评分、原因、综合题小问分及跳过项。考试不提供工具或沙箱，也不额外调用模型修复结果。详见 [数据模型](data-model.zh-CN.md#ai-班级批量批改)。

## 批量、并行与错误反馈

`read_question`、`read_paper_question`、`read_answer`、`read_candidate`、`propose_question`、`propose_enrichment`、`propose_grade` 和 `skip_questions` 统一使用 `items` 数组，一次处理 1–500 个条目。例如：

```json
{ "items": [{ "questionId": "q1" }, { "questionId": "q2" }] }
```

结果为 `{"results":[{"index":0,"success":true,"output":{}},{"index":1,"success":false,"error":{"name":"RequestError","message":"具体错误说明","code":"REQUEST_409","status":409}}]}`。每个结果的 `index` 对应输入位置；条目并行执行，单条业务错误不会丢失其他成功结果，模型只需重试失败项。逐页题数、整卷选题、推荐列表等已有批量工具继续使用各自的 `sources`、`questionIds`、`recommendations` 数组。

同一模型响应可调用多个互不依赖的工具，SDK 并行执行，OpenAI Chat/Responses 显式启用 `parallelToolCalls`。读取后报告、查看图片后引用图片等依赖操作必须等待前置结果；`finish` 和 `report_failure` 独占一轮。Python/shell 共享持久文件系统，同一任务的沙箱执行仍按顺序进行，模型可在一个脚本中批量处理。

工具异常保留具体消息、错误码、状态、校验字段路径及嵌套原因，同时支持 SDK 文本和 JSON 错误编码。未知工具、无效 JSON 和参数 schema 校验错误会反馈给同一个 Agent 修正，并写入执行轨迹，不另开模型调用进行修复。

教师页面只展示教学用语的进度、处理说明和需要核对的图片，不展示工具名、调用参数、代码、退出码、用量或原始结果。中途错误会转成简明原因，并区分“仍在核对”“已继续处理”和“本次已停止”；任务未完成时给出重试、补充清晰图片或联系管理员的建议。完整错误与参数继续保留给模型及诊断记录；管理员可在默认收起的“管理员排查信息”中查看。

## 看不清题目的处理

模型遇到无法辨认的题目或学生作答时，用 `skip_questions` 记录原因并继续处理其他题目，不因此调用 `report_failure`。输入条目为 `{id, reason, sourceUrl?}`：IMPORT 的 `id` 是稳定 `sourceKey`，TEMPLATE 为 `itemId`；练习册 GRADE 使用 `{studentId, itemId, reason}`，其余任务为 `questionId`；IMPORT 同时指定已查看页面的 `sourceUrl`。

跳过项不写入题目或评分，替换同题暂存草稿；后续成功报告可替换跳过项。IMPORT 的成功题目数加跳过数必须匹配逐页清单，ENRICH/GRADE 必须覆盖全部成功项或跳过项。全部题目跳过也能正常 `finish`，结果持久化为 `result.skipped`，任务详情展示题目、原因和可用原图。因无法辨认而未能生成组卷、答题卡或推荐结果时，模型在完成摘要明确说明，不生成不合要求的替代结果。

## 通用工具

`python` 接收 `code`，`shell` 接收 `command`，两者都可指定 `assets` 和 `images`。

- `/inputs/context.json` 包含本次授权任务数据和 `assets: [{url, path}]` 清单。输入只读，不挂载仓库、环境文件、数据库凭据或完整素材目录。
- `assets` 每次指定最多三张合法素材 URL。服务端检查任务授权后，将压缩后的 JPEG 副本挂载到清单路径，长边最多 2400 像素、每张不超过 1 MiB；上传素材保持原样。图片自动校正方向、透明背景铺白，不放大小图，优先调整 JPEG 质量，再按需降低分辨率。模型应按挂载图片的实际尺寸计算像素坐标。
- 本次请求的来源预览与沙箱输出预览都使用 JPEG，长边最多 1800 像素、每张不超过 512 KiB（Base64 后约 683 KiB）。后续调用可继续使用已挂载文件，只有本次实际返回的来源计入查看记录。
- Python 和 shell 共用 `/workspace`。模型可写脚本、保存中间文件、调用已安装程序，自主分解问题。
- 需要查看图像时，使用 Pillow/OpenCV 将图像保存到 `/workspace/output/preview.png`，并在 `images` 填入 `preview.png`。工具向模型返回真实图像像素；只输出路径不等于查看图像。
- 图像导入任务还会为返回的图片生成暂存素材 URL，可填入试题配图。只有任务完成后的原子提交才会持久化实际引用的图片。

例如，先在 `assets` 传入清单中的素材 URL，再运行：

```python
import json
from PIL import Image

manifest = json.load(open('/inputs/context.json'))
image = Image.open(manifest['assets'][0]['path'])
print(image.size)
image.crop((100, 100, 600, 500)).save('/workspace/output/preview.png')
```

该次调用的 `images` 为 `["preview.png"]`。Pillow、OpenCV、NumPy、SciPy、SymPy 和 mpmath 已预装，运行时无法联网安装依赖。

## 隔离和生命周期

Bubblewrap 为每个任务建立独立用户、PID、挂载和网络命名空间，UID/GID 为 65534，移除 capabilities，清空继承环境。系统目录和任务输入只读，可写工作区是 100 MiB tmpfs。每次调用使用新进程，限制 60 秒墙钟时间、30 秒 CPU、512 MiB 地址空间、64 个进程/文件描述符、单文件 36 MiB、无 core dump；stdout/stderr 各返回最多 32,000 字符，最多返回三张 8 MiB 图像。

可信父进程在清理所有子孙进程后读取输出图片，拒绝符号链接、特殊文件和越界路径。沙箱工具调用串行使用任务工作区，超时清理调用进程；沙箱异常退出可重建并明确告知工作区重置。任务退出时在 `finally` 中销毁沙箱和宿主临时目录，不存在未隔离的回退执行路径。

Python/shell 调用代码、命令、退出码与文本输出写入本人专属 `/workspace/ai/[id]` 执行轨迹。运行诊断及部署步骤见 [部署指南](deployment.zh-CN.md)。`pnpm test:sandbox` 在真实 Bubblewrap 中验证隔离、依赖、文件共享、图像输出、资源限制与清理；`pnpm test:ai-domain` 验证这些工具与业务提交的衔接。

## 模型思考强度

管理员在「系统管理 → 模型接入」编辑提供商时，可为每个模型单独选择思考强度：供应商默认、关闭（none）、最低（minimal）、低（low）、中（medium）、高（high）、更高（xhigh）、最高（max）。默认沿用供应商行为。

设置保存在 `AiModel.reasoningEffort`，运行时通过 AI SDK 7 的统一 `reasoning` 参数应用于所有自主 Agent 步骤和考试单次评分。SDK 将其转换为 OpenAI Chat/Responses、Anthropic 或 Google 的原生设置；模型实际支持的档位由供应商决定。HTTP 和 WebSocket 模式每轮都保持所选强度。

OpenAI 兼容接口使用自定义模型 ID 时，显式选择强度会启用 SDK 的 `forceReasoning`，确保该参数不会因模型名称不在 SDK 识别名单中而被忽略；供应商默认档位不启用此选项。

## Responses API 连接模式

管理员在 Responses 供应商设置中选择「HTTP 模式」或「WebSocket 模式」，默认 HTTP；其他协议固定使用 HTTP。配置保存在 `AiProvider.transportMode`，旧的响应 ID 开关已移除。迁移后的现有供应商默认使用 HTTP。

传输行为以 [openai/codex 提交 6fbd7be](https://github.com/openai/codex/blob/6fbd7be1518d259e30e6fef48f05f433d2461a20/codex-rs/core/src/client.rs) 为对照。两种模式均发送 `store: false`、`stream: true` 和 `include: ["reasoning.encrypted_content"]`，不发送 `max_output_tokens`。模型输出上限设置仅用于其他协议。

- HTTP：每轮携带完整的指令、工具定义、文字、加密思考内容、工具调用、结果及图片，不发送 `previous_response_id` 或 `item_reference`。
- WebSocket：每个 Agent 使用独立连接和会话标识；先通过 `generate: false` 预热。仅当请求设置未变且历史完整匹配上一请求及其输出时，通过连接内的 `previous_response_id` 发送新增输入。缺少响应 ID、历史修改或设置变化时发送完整上下文。
- 断线、连接使用上限或响应缓存失效时重新连接，清除旧续接状态并发送完整上下文。与 Codex 默认值一致，WebSocket 建连最多等待 15 秒，断流最多重试五次，以 200 毫秒为起点指数退避并加入 ±10% 抖动；服务不支持升级（426）或连接持续失败时，此 Agent 的后续请求切换为 HTTP，并记录 `platform.ai.transport.http_fallback`。401、403、429 等上游错误保留其状态，不以切换协议掩盖。
- Agent 完成、失败或取消时关闭连接；不同 Agent、不同学生和不同任务之间不共享响应 ID。考试单次评分同样使用所选连接模式。

项目继续使用 AI SDK 的 `ToolLoopAgent` 执行工具、校验和统计成本。传输适配器读取 HTTP SSE 或 WebSocket 事件，将完成响应交给 SDK；这不是复制 Codex 的 Rust Agent、专用鉴权或产品工具。供应商仍须实现所选 Responses 传输协议；本地协议测试不代表已验收某一中转服务。
