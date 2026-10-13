# Oh My Paper

上传 PDF、JPG 或 PNG 试卷，解析为按阅读顺序排列的结构化题目。支持试卷识别、标准答案生成、学生答卷批改，以及管理员 AI 配置。

登录后通过侧边栏使用三个工作区：

- **试卷管理**（`/dashboard`）：添加试卷时可同时上传标准答案，先解析试卷再解析答案；搜索、删除试卷，在详情页手动编辑题目，切换「试题内容 / 标准答案」，上传已有标准答案并解析，或生成、重新生成标准答案。
- **批改管理**（`/grading`）：选择已添加的试卷，上传一位学生的答卷。如果没有标准答案，系统自动生成后继续批改；结果保存在批改记录中。
- **快速批改**（`/quick-grading`）：直接上传有作答痕迹的试卷，可同时上传标准答案。后台识别试卷，再解析上传的答案或自动生成答案，然后批改。结果包含作答转录、逐题反馈和得分。

普通用户仅查看处理状态与完整结果，等待时显示文档动画、累计时间及真实题目进度；工具轨迹、草稿和技术错误不会进入普通用户的详情页面数据。管理员可展开独立的调试面板，查看阶段、草稿和实际工具活动，并下载最小 JSON。

每次最多 20 个文件、50 页、100 MB；单个文件不超过 40 MB。解析在独立 Worker 中执行，刷新或离开页面不会中断任务。

## 数据结构

模型只返回以下内容，未知分值使用 `null`，无配图使用 `[]`：

```json
{
  "name": "数学试卷",
  "totalScore": 150,
  "sections": [
    {
      "number": "四",
      "title": "解答题",
      "description": "本题共5小题，共77分。解答应写出文字说明、证明过程或演算步骤。",
      "score": 77,
      "questions": [
        {
          "number": 15,
          "description": "已知正项数列 $\\{a_n\\}$ 的前 $n$ 项积为 $T_n$，且 $a_n=\\frac{T_n}{T_n-2}$。",
          "materials": [],
          "score": 13,
          "subquestions": [
            {
              "number": "(1)",
              "description": "求证：数列 $\\{T_n\\}$ 为等差数列。",
              "materials": [],
              "score": null
            },
            {
              "number": "(2)",
              "description": "令 $C_n=\\frac{1}{T_nT_{n+1}}$，求前 $n$ 项和 $S_n$。",
              "materials": [],
              "score": null
            }
          ]
        }
      ]
    }
  ]
}
```

上例仅展示第四道大题中的第 15 小题。完整输出按 `sections → questions → subquestions` 保存大题、小题和小问。大题 `number` 是中文数字（如 `一`、`四`），`title` 保存原卷题型标题，`description` 保存一次公共说明；相同的“选择题”标题也按原卷的大题号分别保留。小题 `number` 是阿拉伯数字，沿用原卷的连续编号或分组编号；小问 `number` 使用 `(1)`、`(2)`，更深层的 `(i)`、`(ii)` 保留在小问正文。没有小问时 `subquestions` 为 `[]`。公共题干只保存于小题，公共说明不重复写入每道小题。

各层 `score` 只保存明确印出的满分，未知值使用 `null`；“每小题5分”可确定对应小题分值，小题总分不能自动拆分给小问。`description` 使用 Markdown，公式使用 LaTeX，文字表格使用 Markdown 表格。`materials` 可属于小题或小问，共用图形只保存于父小题；`page` 从 1 开始，坐标为渲染页面宽高的 0–1 比例，原点在左上角。跨页内容按同一大题、小题和小问合并。识别 Agent 只录入题目；答案生成与批改由独立 Agent 处理。

数据库独立保存 `Exam`、`ExamSection` 和 `ExamQuestion`，小问以 JSON 保存于所属小题；程序分配 ID 与阅读顺序，印刷题号另行保留。`Exam` 可有一份 `ExamAnswer`，每道小题的 `QuestionAnswer` 只保存 Markdown 文本 `solution` 和 `gradingCriteria`。`Exam` 可有多份 `Submission`，每道小题的 `SubmissionAnswer` 保存文本 `answer`、`feedback`、`correct` 和 `score`；无法确认正确性或分值时使用 `null`，并说明待复核原因。提交总分由逐题分数计算，不重复保存。复合外键保证小题只能属于同一试卷的大题，答案和提交不能引用其他试卷的题目。答案生成与批改均在 Worker 中执行，完成后分别发布到 `ExamAnswer` / `QuestionAnswer` 与 `Submission` / `SubmissionAnswer`。

数学公式由浏览器中的 KaTeX 渲染，支持 `$...$` 行内公式和 `$$...$$` 独立公式，以及 Markdown 表格中的公式。服务端仅传递原始 LaTeX 文本，不生成公式图片；无法解析的公式保留原文。

## 答案生成与学生答卷批改

识别完成后，试卷的「标准答案」页提供「上传标准答案」与「生成标准答案」两个独立入口。试卷解析与答案解析为独立的 Agent 任务，各自拥有模型上下文、草稿和进度；答案解析不会调用试卷识别 Agent。添加试卷时也可通过 multipart `answerFiles` 附带标准答案，后台持久化依次执行试卷解析、答案解析，到答案准备好即结束，不触发批改。页面关闭或刷新不会影响执行，重试会保留原有文件。上传使用 `POST /api/exams/:id/answers/upload` 接收 PDF、JPG、PNG，并在 Worker 中按试卷题号匹配答案；它只解析上传内容，不自行求解。答案缺失或模糊时不会提交完整结果，请重新上传覆盖全部题目的清晰答案。上传解析和自动生成均使用「AI 生成答案」的模型配置。答案 Agent 使用 `list_questions`、`read_question`／`read_questions` 自主读取大题公共说明、完整题干、小问与材料截图，必要时调用 Python 检查计算或处理配图。`read_questions` 一次读取 1–50 道题及其材料，`append_answers` 一次保存 1–50 道题的 `solution` 与 `gradingCriteria`，全部题目保存后调用 `submit_answers`。评分标准须包含全部小问及部分分规则；未知满分不臆造。

标准答案完成后，可上传一位学生的 PDF、JPG 或 PNG 答卷；文件和页数限制与识别相同，多页按上传顺序处理。批改 Agent 通过沙箱 `shell` / `python` 读取、放大或旋转答卷，`read_question` 获取原题与标准答案，`append_grades` 逐题保存作答转录、正确性、得分和反馈，再通过 `submit_grading` 完成。漏题会阻止提交；明确空白题按未作答处理；无法辨认或匹配不确定的题目使用 `correct=null`、`score=null` 并标记复核。已知分值不得超分，原题满分未知时不自动评分；若全部小问有明确分值，可求和作为该题满分。

两种任务共用识别 Agent 的 SDK `ToolLoopAgent`、提供商配置、并发限制、256 轮调用上限、25 分钟总超时和工具活动记录。每次保存一题后将完整草稿写入 `ExamAgentTask.result`，管理员可展开查看已保存题目；普通用户显示已完成题数和进度条。中断后可点击重试，使用当前提供商配置从数据库草稿续跑。批改使用入队时的标准答案快照，后续重新生成答案不会改变该次批改依据。仅完整提交后发布业务结果，重新生成失败时已有标准答案仍有效。活动和工具预览继续只向试卷所属管理员开放。

接口以识别任务 ID 为路径：`POST /api/exams/:id/solutions` 启动答案生成；`POST /api/exams/:id/grading` 接收 `files` multipart 学生答卷；`GET /api/exams/:id/agents` 获取任务和完整结果（逐题草稿仅管理员可见）；`POST /api/exams/:id/agents/:agentId/retry` 继续失败任务。同一试卷只允许一个答案生成任务运行，用户最多同时运行三个答案或批改任务。

答案和批改的总题数使用已识别题目数量，不依赖原始文档是否标注完整卷面总题数。答案 Agent 可通过 `read_questions` 一次读取多道题，使用 `append_answers` 一次保存多道答案（每批 1–50 道）；单题 `read_question` 继续可用。批改 Agent 的 `append_grades` 每次保存一题。两类 Agent 均可在一轮中并发调用独立工具，并通过共享的沙箱 `python` / `shell` 裁剪和查看图片。答案与批改均支持无分值的练习册题目，缺失满分不推断；照片中缺失题干或作答证据时明确说明信息不足。上传答案或学生答卷时，沙箱页面仅来自该任务上传的文件。快速批改页面分别显示解析、答案和批改进度；计数向普通用户公开，草稿内容仅管理员可见。

OpenAI 兼容 Chat 接口的工具图片会通过 `prepareStep` 转成真正的用户图片消息，避免图片以 base64 文本进入模型上下文。原始工具调用和结果仍保留关联，其他接口使用各自的原生多模态工具结果。

`POST /api/exams/:id/grade` 新建自动准备标准答案的批改流程；`POST /api/quick-grade` 接收一份带作答的试卷并新建快速流程，可通过 multipart `answerFiles` 字段附带标准答案。作答文件与标准答案合计最多 20 个、100 MB，文件会分开保存；解析试卷和批改只读取学生作答，答案解析只读取标准答案。未上传答案时保持自动生成。`GET /api/workflows` 返回轻量历史列表，`GET /api/workflows/:id` 返回角色过滤后的详情，`POST /api/workflows/:id/retry` 重试失败流程。

自动批改与快速批改使用持久化的 `GradingWorkflow` 串联任务。协调任务每次检查后在同一事务中写入下一次队列检查，子任务创建与流程关联也在同一事务内提交。页面关闭不会影响运行；重复投递不会重复创建批改，失败后可重试并保留上传文件与已保存草稿。每位用户最多同时运行 3 个串联流程。`QUEUE_SCHEMA` 默认为 `pgboss`，Web 和 Worker 使用相同值；集成测试使用独立的临时队列 schema。

## Credit 与用量统计

注册用户自动获得 100 credit，迁移也为已有用户初始化 100 credit。首个注册的账号自动成为管理员，管理员可以在 `/admin/users` 管理用户角色、资料、额度和密码。用户在添加试卷、批改管理、快速批改和标准答案操作区直接选择本次任务使用的公开模型与推理强度；快速批改可分别选择解析、答案与批改模型。账户偏好仍可从顶栏 `/ai-settings` 保存。选择优先级是本次任务 > 账户偏好 > 后台默认，本次选择不修改账户偏好；选择和倍率会保存为任务快照，后续串联步骤不会读回后台默认覆盖它。管理员在 `/admin/ai` 的模型编辑区勾选「对公众开放」并配置扣费倍率（默认 1，支持四位小数）；未公开模型不会出现在用户选项中，服务端也禁止选择。普通用户未指定模型时优先使用对应功能的公开默认模型，否则使用首个公开模型；没有公开模型时无法创建任务。管理员未自行选择模型时继续使用后台功能配置。

每轮模型返回用量后结算，单个 token 也按比例计费，不按 1,000 token 向上取整：

```text
credit = [(输入 token - 缓存命中输入 token) × 0.1 / 1000
          + 缓存命中输入 token × 0.02 / 1000
          + 输出 token × 0.5 / 1000] × 模型扣费倍率
```

输出包含接口报告的推理 token，缓存写入按普通输入计价；未报告缓存命中量时按普通输入计价。余额与流水使用八位小数存储，计算使用整数 microcredit，避免浮点误差。用量以提供商实际报告为准；模型未返回有效用量时停止后续调用，不将缺失用量当作免费。倍率保存在任务快照中，后台修改不会影响已提交的任务。

管理员额度不限量，不扣减余额、不受负余额限制；调用仍记录 token 和折算 credit，排行榜余额显示「不限量」。管理员从 `/admin/usage` 用户列表点击「添加 credit」为普通用户增加额度，使用 `POST /api/admin/users/:id/credits`。添加记录保存在 `credit_grants`；请求 UUID 防止网络重试和并发重复入账。普通用户无权修改余额。

普通用户采用宽松结算：余额为零仍可创建任务；余额变负后，已创建的当前 Agent 继续运行并结算，但禁止创建或重新启动其他 Agent。快速批改和试卷附带答案在切换到下一个 Agent 时也检查余额；余额为负时保留前一步结果并提示。既有任务执行不受浏览器刷新或关闭影响。

任务进度每 2–2.5 秒刷新「已消费 credit」，顶栏每 3 秒更新余额。实际用量只有模型响应返回后才可用，响应尚未返回时保留上次结算值。同一用户的并发扣费在数据库事务中串行结算；流水以 SDK 执行 ID 与轮次去重。工具失败、任务失败或重试不会返还已发生的调用消费，重试成本累计到任务。复用已有标准答案不会将其历史消费计入新的批改流程消费。

用户界面只显示余额、已消费 credit、模型倍率与速度/准确率/费用的取舍提示，不展示 token 单价或计费公式。

管理员的 `/admin/usage` 每 5 秒刷新系统累计 credit、输入/输出/缓存命中 token、调用次数，以及用户与模型排行榜，可按 credit 或总 token 排序。总 token 为输入加输出，不重复加缓存命中输入。统计从计费机制启用时开始，历史任务中未记录的 token 无法回填。用户统计包括余额，模型统计包括未公开或已删除模型的已记录调用。普通用户无法读取统计页或 `/api/admin/usage`。用户配置接口为 `GET/PUT /api/ai/settings`，修改只作用于当前登录用户。

## 活动记录与错误诊断

解析页的「识别 Agent」仅对管理员显示，每轮模型调用默认折叠为一行摘要，展开后可查看模型消息、真实工具调用、工具输入/结果、执行耗时及图像预览。执行中和报错的轮次也保持默认折叠。识别 Agent 第一轮调用 `report_exam_meta` 上报 A3/A4 纸型、1–4 栏、页面方向和上传页面可见的独立题目总数，小问不重复计数，最高题号不等于题数。无法可靠确定题数时可报告 `total=null`，练习册片段无需凑成完整试卷或上传整本书；缺失分值保持 `null`。纸型与分栏保存在结果中，编辑页可以校正并用于 PDF/Word 导出。已知总数必须与保存题数对齐；未知总数允许在读完上传页面、保存全部可见题目后提交。Agent 使用沙箱 `shell` / `python` 查看和裁剪图像，使用 `append_questions` 增量保存题目；程序按分组与题号合并，练习册不同章节重启题号时保留独立分组。使用 `submit_exam` 提交最终名称和明确总分或 `null`，无需重新输出整篇内容。最多 256 次模型调用，任务整体仍受 25 分钟超时限制。

每次追加成功后，累计题目原子写入本次任务目录的 `draft.json`。识别中断或失败时保留最近的有效草稿；草稿不表示整卷完成，也不会直接发布到数据库。完成后生成材料裁剪和 `exam.json`、删除草稿，再发布完整试卷。工具执行和页面准备记录保存在同目录的 `agent.jsonl`，不加入下载的题目 JSON。识别仅使用页面图像，不提取 PDF 文字层。

Agent 可调用 `shell` 执行沙箱命令，也可调用 `python` 执行任意 Python 代码，使用预装的 Pillow 旋转、纠偏、裁剪或增强图像。图像结果会直接回传给模型，活动记录中也能预览。直接覆盖 `/workspace/pages/001.jpg` 即可更新页面，后续 `read_pages`、`inspect_image` 和最终材料裁剪自动使用更新后的文件与尺寸，不需要 `replacePages` 元数据。需要额外给模型看预览时，可用 `images` 列出保存在 `output/` 的图像文件名。页面一旦被已保存的材料坐标引用，就禁止替换，以防已有材料错位；应先纠正页面方向，再保存题目。

普通用户的 API 失败返回公开恢复提示；管理员响应保留具体提示、`code`、`errorId`，并通过 `X-Error-Id` 响应头关联服务器日志。任务失败保存具体原因、处理阶段和错误编号；活动记录也保留失败事件。Web/Worker 输出 JSON 格式诊断：时间、操作、任务/队列、阶段、异常类型、状态码、异常调用链和调用位置。认证失败、权限不足、额度限制、超时、格式校验、数据库和文件/工具错误分别给出提示。浏览器记录网络、资源加载、页面渲染和未处理异常。可通过错误编号或任务 ID 搜索日志。

Web 请求错误查看 Web 控制台，后台解析与工具错误查看 Worker 控制台；`pnpm dev` 会同时输出两者。日志过滤凭据，且不序列化完整请求、模型响应或数据库记录；活动记录及工具预览接口仅向拥有该试卷的管理员开放。改动前的任务没有可追溯的工具记录，新任务会保存活动。

## AI 配置

管理员在 `/admin/ai` 配置提供商。每个提供商可以添加多个模型，每个模型分别填写「API 模型代码」与可选的「显示名称」，显示名称用于模型选项、列表与排行榜，留空时显示代码；实际 API 请求继续发送模型代码。每个模型单独列出支持的推理选项。「功能默认模型」分别为 AI 解析、AI 批改、AI 生成答案选择模型与推理程度，每项独立保存，也可选择不同提供商。后台配置仅作默认值。用户在创建任务时可以指定公开模型，即使后台未设置默认模型也可使用自己的选择；未自行选择时才读取账户偏好或后台默认。运行中的任务保留提交时的配置快照。

支持 OpenAI Responses、OpenAI 兼容 Chat Completions、Anthropic Messages 与 Google Generative AI。仅勾选实际模型支持的选项；`默认` 不发送推理参数，`关闭` 使用接口的关闭推理设置，其余选项映射至对应 API 的 reasoning/thinking 参数。模型需支持图片输入。API key 使用服务端 AES-GCM 加密，不传给浏览器。

Responses 调用使用 `store: true`，允许服务商保存响应。该选项控制响应存储，不是自动提示词缓存的开关。第三方网关显式选择推理强度时，通过 SDK 的 `forceReasoning` 发送实际的 `reasoning.effort`，不依赖 OpenAI 模型名称白名单；保留网关原有的 `system` 角色，且不额外请求推理摘要。多轮调用保留已有消息和固定工具定义。提供商返回加密推理状态时，优先原样回传加密内容，即使同时有响应条目 ID 也不改用存储引用；同一推理条目的多个流式摘要合并后一起回传。未返回加密内容但有条目 ID 时，SDK 通过 ID 引用已存储的推理内容；无可恢复状态的摘要不回传。文本、工具调用及结果继续保留。

所有模型请求均使用流式 API：Agent 使用 `ToolLoopAgent.stream()`，单题评分和直接 JSON 生成使用 `streamText()`。Worker 持续消费流，管理员活动记录每轮首次开始输出的时间；模型完整结束后才执行工具或校验并保存最终 JSON。Chat Completions 请求流末尾的 token 用量用于结算；流错误、中断和超时向任务层传播，不将部分输出当作完整结果。Responses 流逐事件兼容后交给 SDK，不等待整个响应体，也不因网关错误标注 Content-Type 而转为整体读取。工具调用起始事件省略 `arguments` 时补为空字符串，后续参数增量和完整参数仍由 SDK 校验。

管理员可在 AI 设置中删除提供商，确认后同时删除其模型，清除关联的功能默认模型和用户选择；相关功能需要重新配置。已有任务配置快照、答案和用量记录保留，运行中的任务继续使用原快照。接口为 `DELETE /api/admin/ai/providers/:id`，验证管理员权限和请求来源。

提供商的「请求超时（秒）」分别限制等待响应头、收到响应头后等待首次有效输出，以及后续连续没有有效输出的时间；文本、思考或工具参数增量都属于有效输出，SSE 心跳不算。持续输出的模型不会因为整轮总耗时超过此值而中止；整个 Agent 任务仍受 25 分钟上限限制。流式传输便于观察进度，不保证减少模型总推理时间。

答案尚未开始解析时，答案页显示等待和题目进度，并持续刷新；初始化失败可通过 `POST /api/exams/:id/answers/upload/retry` 重试。答案准备流程不会出现在批改历史中。

页面日期、时间及管理员活动记录统一使用北京时间（`Asia/Shanghai`），避免服务器与浏览器时区不同造成 hydration 错误。

## GitHub CI 与镜像发布

`.github/workflows/ci.yml` 在每次分支或 tag 推送时安装锁定依赖并执行 `pnpm run lint`。推送 tag 且 Lint 通过后，分别构建 Dockerfile 的 `web`、`worker` 目标，将 Linux amd64 镜像发布到 GitHub Container Registry（GHCR）。工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，只为发布任务授予 `packages: write`，无需额外配置仓库密钥；Actions 依赖固定到提交哈希。

将工作流提交并推送到 GitHub 后，可用以下命令发布一个版本（示例版本号）：

```bash
git tag v1.0.0
git push origin v1.0.0
```

当前仓库生成 `ghcr.io/tairuiqu/oh-my-paper:v1.0.0` 与 `ghcr.io/tairuiqu/oh-my-paper-worker:v1.0.0`，分别对应 Web 和 Worker（Worker 镜像也可执行迁移）。镜像路径随仓库名称变化并转为小写；tag 中不符合 Docker 命名规则的字符会被规范化。同时生成 `latest` 标签，供部署端自动更新。发布结果与构建记录可在仓库 Actions / Packages 查看。

## 本地启动

使用 Node.js 24、pnpm 11 和 PostgreSQL。根据 `.env.example` 配置连接与随机密钥，并安装 Poppler 的 `pdfinfo`、`pdftoppm` 工具。

本地 Python 工具需要 Linux、Bubblewrap、`prlimit` 和允许非特权用户命名空间的内核。Ubuntu/Debian 可安装 `bubblewrap python3 python3-venv util-linux`，再准备 Pillow 环境：

```bash
python3 -m venv .venv
.venv/bin/pip install -r tools/python/requirements.txt
```

沙箱优先使用 `PYTHON_SANDBOX_VENV` 指定的虚拟环境，默认检查项目的 `.venv`；没有默认虚拟环境时使用系统 Python（也须安装 Pillow）。每个 Agent 运行期间独享一个 100 MiB 的可写文件系统，`python` 与 `shell` 工具共享 `/workspace`，文件修改自动保留到后续调用，不需要显式同步。`/tmp` 也位于该配额内；任务完成、失败或取消后销毁沙箱，任务重试会获得新的工作区。每次执行启动新进程，变量和后台进程不会保留；单次超时会终止命令，工作区仍能复用。沙箱隔离网络、进程和用户命名空间，清空宿主环境变量、禁用继续创建用户命名空间，并只读挂载运行环境、本次任务页面与工具预览，不挂载项目或凭据。数值库线程数限制为 1，避免 NumPy/OpenCV 的线程池耗尽资源。单次调用限制为 60 秒、30 秒 CPU、512 MiB 地址空间、64 个进程和 64 个文件描述符；最多回传 3 张各 8 MiB 的图像。`shell` 可以执行任意已安装的命令，以 `command` 传入命令，使用相同的 `images` 与 `replacePages` 图像协议。异常、进程崩溃和超时会分别返回诊断，不改用宿主环境执行。

Worker Docker 镜像预装 Bubblewrap 与 Pillow 12.3.0。`compose.yaml` 仅对 worker 取消 Docker 默认的 seccomp/AppArmor 配置，以允许 Bubblewrap 创建嵌套命名空间和挂载；worker 同时移除所有 Linux capabilities 并启用 `no-new-privileges`。宿主内核仍须支持非特权用户命名空间。`pnpm doctor` 会实际运行一次隔离 Python，检查 Bubblewrap 和 Pillow；沙箱测试也需要同样的运行环境。

```bash
pnpm install --frozen-lockfile
pnpm run db:setup
pnpm run dev
```

`db:start` 使用本仓库 `.tools/postgresql` 中的本地 PostgreSQL；使用其他数据库时直接运行 `db:generate`、`db:deploy`。首个注册的账号自动成为管理员，管理员可以在 `/admin/users` 管理用户角色、资料、额度和密码。

迁移 `20261012060000_minimal_exam_model` 重新建立业务数据结构，删除旧试卷任务、AI 配置、工作空间、班级、批改与练习数据。账号与会话保留。旧数据没有兼容或转换层；应用迁移后重新配置 AI 并上传试卷。对现有数据库应用前应保留所需备份。Web 和 Worker 需一同更新并共享存储与加密密钥。

## 检查

迁移 `20261012080000_exam_question_hierarchy` 增加大题、小题号和小问字段，保留已有题目、答案与提交。旧结果归入“一、题目”，正文与原始下载文件保留；重新上传解析才能从原卷恢复真实层级。

迁移 `20261012100000_answer_grading_agents` 新增答案/批改任务与批改反馈，保留现有试卷、答案和提交。

迁移 `20261012120000_management_workflows` 增加后台串联流程，并将现有批改任务关联到新的批改记录列表。升级时先运行 `pnpm run db:deploy`，然后重启 Web 和 Worker。

迁移 `20261012180000_question_progress` 增加解析计数与答案/批改总题数，为已有完成任务回填题数，并约束计数不能超过总数。

迁移 `20261012220000_sequential_answer_upload` 增加先解析试卷、再解析附带标准答案的独立处理流程类型，保留现有批改与快速批改记录。

迁移 `20261012210000_uploaded_reference_answers` 保存快速批改上传的标准答案文件列表，已有流程默认没有上传答案；升级时先运行 `pnpm run db:deploy`，再一同更新 Web、Worker。

迁移 `20261012200000_ai_purpose_settings` 将已有解析模型复制为答案与批改的初始配置，保留已独立配置的选项。升级时运行 `pnpm run db:deploy` 并一同更新 Web、Worker，然后在 AI 设置中按需分别选择模型。

```bash
pnpm run check
pnpm run build
pnpm run test:integration
```

单元测试覆盖最小输出契约、多页解析、材料裁剪、上传限制、SDK 推理参数、真实工具调用、活动回放、具体错误、凭据过滤、Markdown 数学与任务调度。集成测试在临时 PostgreSQL schema 中验证完整迁移、答案与提交的关系约束和任务持久化，并验证答案与批改的逐批写入、完整发布、重复投递、答案快照与失败续跑；并以真实 multipart 上传验证快速批改的识别 → 自动生成答案 → 批改全流程；结束时删除临时数据库和队列 schema；模型响应使用模拟数据，不调用外部模型。

## 页面字体

中文使用 Noto Sans SC，英文和数字使用 Geist。字体由固定版本 Fontsource 包提供，随静态资源自托管；通过 Unicode 分片按需加载，`font-display: swap` 保证加载期间仍可阅读。访问页面和生产构建均不需要请求 Google Fonts，Windows 的主字体不再依赖微软雅黑；公式继续使用 KaTeX 字体。

管理员在 `/admin/exams` 可按试卷名称、用户姓名或邮箱分页审查全系统试卷，包含快速批改中的试卷；详情展示试题、材料及标准答案。审查接口独立于所属用户的操作接口。`/admin/users` 支持搜索用户、编辑姓名与角色、添加 credit，以及设置 10–128 字符的新密码。密码通过 Better Auth 的哈希实现保存，重置后撤销全部登录会话；角色变更也撤销会话，且禁止移除最后一名管理员。管理接口要求当前数据库中的管理员角色，写操作验证同源。

试卷列表和详情页支持删除：确认后试卷立即从用户列表及批改试卷选择中移除，原始文件、题目、答案和执行记录保留，管理员仍可通过记录审查访问并查看删除时间。详情页的「编辑试卷」支持修改名称、大题标题与说明、题干、选项、小问和分值，支持 Markdown 与数学公式预览，保留题号、顺序、题目 ID 和配图。保存检查版本冲突；答案生成或批改进行中时不能保存。保存后新版试题需重新生成或上传标准答案，旧答案和批改记录保留在历史记录中。接口为 `DELETE /api/exams/:id` 与 `PATCH /api/exams/:id`，均验证登录用户归属和请求来源。

试卷解析完成后，详情页提供「导出 PDF」和「导出 Word」，管理员审查页也可导出。两种格式使用识别或编辑后的 A3/A4 纸型、横纵方向和 1–4 栏排版，采用 10 mm 页边距，正文按栏宽使用 8–11 pt 宋体；历史记录没有元信息时默认 A4 纵向单栏；大题说明加粗，题号与题干同行，选择题选项横排。PDF 保留可搜索中文、公式、表格、分值和配图，长题干与表格可跨栏、跨页。PDF 与 Word 中的小问题号（如 `(1)`）与正文首段同排，后续段落、独立公式和表格保留原有结构。Word 为 `.docx`，使用对应的原生分栏，正文、标题和表格保持可编辑，数学公式转换为 Word 原生 Office Math（OMML）对象，可在 Word 公式编辑器中直接修改分式、根号、上下标、矩阵及其他数学结构，不生成公式图片。无法转换的公式会提示检查 LaTeX 语法，避免生成缺失内容的文档。三种公式写法 `$…$`、`$$…$$`、`\(…\)` 均受支持，代码块保持原文。普通用户仅可导出自己的试卷，管理员通过独立审查接口导出全站试卷。

导出在 Web 服务中执行。PDF 需要系统 Chromium（或 Google Chrome）和中文字体；Word 在 Node.js 内直接生成原生公式，不需要浏览器。Docker Web 镜像已安装 Chromium 与 `fonts-noto-cjk`；本地 Debian/Ubuntu 可安装 `chromium fonts-noto-cjk`，其他浏览器路径可通过 `EXPORT_CHROMIUM_PATH` 指定。PDF 默认字体采用新宋体 NSimSun 5.03，字体从 `simsun.ttc` 的 NSimSun face 提取并保存于 `assets/fonts/nsimsun.ttf`，通过 `@font-face` 内嵌；无需系统安装或导出时下载。默认字体、KaTeX 字体和配图随文档内嵌，导出浏览器禁用页面脚本及外部网络加载。`node --conditions=react-server --import tsx scripts/check-exam-export.ts` 可生成测试 PDF/Word，并检查长文档分页、可搜索中文、可编辑正文及原生公式，产物位于 `tmp/exam-export-check`。

Worker 镜像使用 `pnpm run build:worker` 生成的独立运行目录，只包含编译后的入口、实际运行依赖、数据库迁移与 Python 沙箱脚本，不再复制完整 `node_modules` 和应用源码。快速批改的「标准答案（可选）」默认折叠，选中文件后仍在摘要显示数量。

部署说明：[通用部署手册](docs/deployment.zh-CN.md) · [v0.1.13 部署与升级指南](docs/releases/v0.1.13.zh-CN.md)。

Word 公式转换复用 KaTeX 与 docx，新增 `mathml2omml@0.5.0`（约 67 KB 运行时代码，无运行时依赖），并直接声明已有 docx 依赖 `xml-js`。转换库以未修改的运行时模块随应用分发，其 LGPL-3.0-or-later 许可及来源见 [第三方依赖说明](docs/third-party.md)。

## 答题卡批量批改

从「批改管理」或「快速批改」进入「答题卡批量批改」（`/grading/cards`）。先选择已识别的试卷并上传同版式答题卡模板；区域标记 Agent 可自主查看、放大页面，将选择题、填空题、解答题及跨页续答区域匹配到题目 ID。完成后可以展开模板预览，检查每道题的范围；同一模板可重复使用。评分前须在试卷详情准备覆盖全部题目的标准答案。

批量上传时，每位学生可以使用一个完整 PDF；双面或多页图片按照指定的「每位学生的图片文件数」连续分组，文件列表按正面、反面等页面顺序排列。每次仍限制 20 个文件、100 MB，单文件 40 MB。学生页数、方向和宽高比须与模板一致。

后台把同一批次所有学生的题目放入统一并发池，每题仅发送对应作答截图、完整题干、材料和参考答案，使用一次无工具、无自动重试的 `streamText` API 调用。提供商并发上限继续生效；每次实际响应记录用量并结算 credit。逐题保存结果，单题失败不会丢失其他题目；「重试未完成题目」只调用缺失题目。每位学生完整评分后发布为 `Submission`，普通用户只看到完整报告，管理员可以读取诊断。模板与批次保存在 PostgreSQL 和 pg-boss，关闭页面不会中断。

新增数据库迁移需要执行 `pnpm db:deploy`。可运行 `node --conditions=react-server --import tsx scripts/test-answer-cards.ts`，在独立临时数据库 schema 中验证模板、双面分组、并发、计费、访问权限及失败恢复，不调用外部模型。

## 文档扫描预处理

所有识别、答案解析、学生答卷批改和答题卡任务在模型读图前统一处理页面。JPG / PNG 先按 EXIF 校正方向，在原始分辨率上去除透明背景；DocCornerNet-Regression 的 320×320 ONNX 模型检测文档四角，坐标映射回原始宽高后由 OpenCV `warpPerspective` 矫正。输出尺寸来自原图中文档边长，不使用检测缩略图裁切或统一缩小到 2800px。PDF 按 300 DPI 渲染，保留页面范围并增强，不再以 2800px 作为长边上限。

随后仅对亮度做轻度局部对比增强和锐化，保留红笔、淡笔迹及颜色。已有平整扫描件、置信度低于 0.9 或不可靠四边形保持完整页面，只做增强；原始上传文件始终保留。每页的角点、置信度、原始/输出尺寸和处理原因写入私有 `pages/NNN.jpg.scan.json`，可用于管理员排查。

模型文件及 MIT 许可随仓库和 Worker 产物打包，来源、固定版本及 SHA-256 见 [assets/models/README.md](assets/models/README.md)。生产 Worker 使用 OpenCV DNN，不安装 PyTorch，不在请求时下载模型。Docker 构建会安装 `tools/python/requirements.txt`；本地安装依赖：

```bash
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/document-scan/test_scan.py
```

默认使用本地 `.venv/bin/python`；Docker 使用 `PYTHON_SANDBOX_VENV=/opt/python-sandbox`。需要自定义时设置 `DOCUMENT_SCAN_PYTHON` 和 `DOCUMENT_SCAN_MODEL`。缺少 Python / OpenCV / 模型会停止预处理并保留可重试任务，避免在部署不完整时悄悄跳过扫描。
