# Agent 工具与沙箱

平台有六类自主 Agent，均由 AI SDK `ToolLoopAgent` 根据任务和工具结果自主决定下一步。工具入口为 `src/server/platform/ai/features.ts`，不预设模型必须执行的固定流程。

## 工具清单

所有 Agent 共同拥有 `python`、`shell`、`finish` 与 `report_failure`。其余工具负责读取受权业务对象或提交经过验证的业务结果：

| Agent                     | 业务工具                                                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| 图片导入 `IMPORT`         | `record_source_inventory`、`propose_question`                                     |
| 答案与知识点补全 `ENRICH` | `read_question`、`propose_enrichment`                                             |
| 智能组卷 `ASSEMBLE`       | `search_questions`、`read_question`、`propose_paper`                              |
| 答题卡 `TEMPLATE`         | `read_paper`、`read_paper_question`、`generate_layout`、`propose_template`        |
| 阅卷 `GRADE`              | `list_items`、`read_answer`、`propose_grade`                                      |
| 巩固练习 `RECOMMEND`      | `read_learning`、`search_candidates`、`read_candidate`、`propose_recommendations` |

`generate_layout` 提供现有答题卡引擎的可编辑初稿，模型也可自行计算布局后提交。业务提交工具保留账号权限、真实题目 ID、题型完整性、评分上限、多人评阅和事务校验；沙箱无法直接连接数据库或绕过这些规则。

旧版 v0.1.15 已有通用 Python 与 shell 沙箱。此次复用其隔离机制，并移除 v2 的 `inspect_image`、`crop_material`，图像查看、旋转、裁切、增强、统计和数学运算由模型编写代码完成。

## 通用工具

`python` 接收 `code`，`shell` 接收 `command`，两者都可指定 `assets` 和 `images`。

- `/inputs/context.json` 包含本次授权任务数据和 `assets: [{url, path}]` 清单。输入只读，不挂载仓库、环境文件、数据库凭据或完整素材目录。
- `assets` 每次指定最多三张合法素材 URL。服务端检查任务授权，复制 PNG 到清单路径，并将本次请求的原图预览返回模型；后续调用可继续使用已挂载文件。只有本次实际返回的来源计入查看记录。
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

可信父进程在清理所有子孙进程后读取输出图片，拒绝符号链接、特殊文件和越界路径。工具调用串行使用任务工作区，超时清理调用进程；沙箱异常退出可重建并明确告知工作区重置。任务退出时在 `finally` 中销毁沙箱和宿主临时目录，不存在未隔离的回退执行路径。

Python/shell 调用代码、命令、退出码与文本输出写入本人专属 `/workspace/ai/[id]` 执行轨迹。运行诊断及部署步骤见 [部署指南](deployment.zh-CN.md)。`pnpm test:sandbox` 在真实 Bubblewrap 中验证隔离、依赖、文件共享、图像输出、资源限制与清理；`pnpm test:ai-domain` 验证这些工具与业务提交的衔接。
