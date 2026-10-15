# Agent 工具与沙箱

平台有六类自主 Agent，均由 AI SDK `ToolLoopAgent` 根据任务和工具结果自主决定下一步。工具入口为 `src/server/platform/ai/features.ts`，不预设模型必须执行的固定流程。

## 工具清单

所有 Agent 共同拥有 `python`、`shell`、`skip_questions`、`finish` 与 `report_failure`。其余工具负责读取受权业务对象或提交经过验证的业务结果：

| Agent                     | 业务工具                                                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| 图片导入 `IMPORT`         | `record_source_inventory`、`propose_question`                                     |
| 答案与知识点补全 `ENRICH` | `read_question`、`propose_enrichment`                                             |
| 智能组卷 `ASSEMBLE`       | `search_questions`、`read_question`、`propose_paper`                              |
| 答题卡 `TEMPLATE`         | `read_paper`、`read_paper_question`、`generate_layout`、`propose_template`        |
| 阅卷 `GRADE`              | `list_items`、`read_answer`、`propose_grade`                                      |
| 巩固练习 `RECOMMEND`      | `read_learning`、`search_candidates`、`read_candidate`、`propose_recommendations` |

`generate_layout` 提供现有答题卡引擎的可编辑初稿，模型也可自行计算布局后提交。业务提交工具保留账号权限、真实题目 ID、题型完整性、评分上限、多人评阅和事务校验；沙箱无法直接连接数据库或绕过这些规则。

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

模型遇到无法辨认的题目或学生作答时，用 `skip_questions` 记录原因并继续处理其他题目，不因此调用 `report_failure`。输入条目为 `{id, reason, sourceUrl?}`：IMPORT 的 `id` 是稳定 `sourceKey`，GRADE/TEMPLATE 为 `itemId`，其余任务为 `questionId`；IMPORT 同时指定已查看页面的 `sourceUrl`。

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

## Responses API 上下文续接

`openai_responses` 使用 `store: true` 保存服务端上下文。同一任务首轮发送完整任务要求，后续通过 `previous_response_id` 引用紧邻的上一轮响应，只发送本轮工具结果及其图片，不再重传整段历史。每轮继续发送 Agent 指令和工具定义；任务之间不共享响应 ID。供应商必须支持响应保存和 ID 续接，未返回响应 ID 时会明确报错。
