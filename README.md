# Oh My Paper v2

面向 K12 教师和学生的题库、组卷、考试阅卷与学情平台。工作台位于 `/workspace`，考试与日常作业明确区分。

管理员负责账号权限和模型配置，同时拥有教师权限。教师可以维护题库、班级、试卷、考试和评阅；学生仅查看自己的已发布成绩、错题和知识点分析。第一个注册账号成为管理员，后续注册账号默认是学生，由管理员授予教师权限。

## 日常流程

1. 在「班级与学生」创建班级、录入卡号和姓名，通过账号或邮箱绑定已注册学生；指定可参与双评的教师。
2. 在「题库」创建单选、多选、填空、主观或混合题。分别维护选项、各空答案、混合子题、参考答案、解析、评分标准、知识点、难度、学科和年级；题目可附图片。
3. 在「试卷与作业」搜索选题、调整顺序、设置分组与分值，选择 A4/A3 和栏数，打开打印页面。组卷保存题目快照，题库修改不改变已有卷子；已布置试卷需另存后调整。
4. 在「答题卡模板」选择九科高考模板，针对当前卷子生成各题答题区域；调整区域位置、尺寸和图片后保存、打印。卡片包含四个定位点、六位学号填涂区和页面识别码。
5. 在「考试与作业安排」组织一个或多个班级、多科试卷，设置单评或双评、仲裁阈值，以及生物/化学等科目的排名赋分区间。参试学生名单在布置时保存。
6. 在「扫描与作答录入」批量上传 PNG/JPEG/WebP 答题卡；多页按每位学生的页码顺序上传。系统按定位点矫正、识别学号并逐题切图；身份不明确时选择学生重新提交。无答题卡练习册作业可选择学生、逐题框选区域后导入。
7. 在「阅卷工作台」结合原题、标准答案、评分标准和实际作答评分。双评要求不同教师；分差超过阈值需第三位教师仲裁。所有参试学生的全部科目完成评阅后，由组织教师发布成绩。
8. 在「成绩与学情」查看原始分、赋分、多科总分、联合排名、班级排名、错题和薄弱知识点。学生仅能读取自己的已发布结果；并列总分使用相同排名。

直接连接扫描仪通过运行在设备所在电脑的 [本机桥接](scripts/scanner-bridge/README.md)，支持 SANE 和 eSCL。网页可选纸张来源和分辨率；eSCL 自动进纸器支持单/双面多页采集，按页序加入上传列表，SANE 每次采集一页。真实设备尚未接入当前验收环境；协议模拟测试不代表硬件验收完成。

## 本地运行

需要 Node.js 24.19+（24.x）、pnpm 11、PostgreSQL 和 Python 3.11+。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
python3 -m venv .venv
.venv/bin/pip install -r tools/card-scan/requirements.txt
pnpm db:generate
pnpm db:deploy
pnpm dev
```

编辑 `.env` 设置有效的数据库连接、站点地址和随机认证密钥。`pnpm db:start` 适用于已准备仓库 `.tools/postgresql` 的本地环境；普通部署使用独立 PostgreSQL 即可。`CARD_SCAN_PYTHON` 可指定扫描 Python 路径，默认优先 `.venv/bin/python`。`STORAGE_ROOT` 保存原图和逐题截图，数据库保存文件引用；数据库和存储目录应一起备份。

生产 Web 启动使用 `pnpm build && pnpm start`。AI 任务执行进程使用 `pnpm build:ai-worker && pnpm start:ai-worker`，需与 Web 同时运行；`pnpm dev` 默认同时启动 Web 和 AI Worker。v2 的人工流程、扫描矫正和人工阅卷在 Web 服务内完成；旧 Worker 与 pg-boss 队列已移除，新 AI Worker 使用 PostgreSQL `AiJob` 持久化任务。

## 数据与接口

新业务模型为 `Question`、`Paper` / `PaperItem`、`Classroom` / `ClassroomStudent`、`Assessment` / `AssessmentPaper`、`CardTemplate`、`ScanSubmission`、`Review` 、`PlatformAsset` 和 `AiJob`。试卷题目保存完整快照，考试保存参试名单，答卷按学生、场次、科目唯一，评阅记录按答卷、题目、轮次唯一。

统一 `GET /api/platform` 提供权限过滤后的状态，`POST /api/platform` 接收命令。服务重新读取数据库当前角色，不接受客户端传入的权限、所属教师或评阅者身份。业务修改使用数据库事务，并序列化相互依赖的评阅与发布操作。

参阅 [接口契约](src/server/platform/README.md) 和 [平台类型](src/contracts/platform.ts)。AI 功能在完成非 AI 验收后接入同一服务层；具体能力与验收证据由 [迁移 PRD](v2-docs/migration-prd.md) 及验收记录约束，不以模拟模型通过证明外部模型质量。

## 验证

```sh
pnpm check
pnpm build
pnpm test:integration
pnpm test:scan
pnpm test:ai-jobs
pnpm test:ai-domain
pnpm test:http
# 使用已配置真实模型（会调用供应商）：
pnpm test:ai-live
pnpm build:ai-worker
python3 -m unittest discover -s scripts/scanner-bridge -p 'test_*.py'
pnpm run doctor
```

`test:integration` 在独立 PostgreSQL schema 应用全部历史及 v2 迁移，验证五题型、题目快照、班级账号绑定、双评仲裁、多科联合排名、生化赋分、发布条件和学生数据隔离。`test:scan` 验证带透视的实际图像、学号与客观题识别、上传持久化、逐题截图和练习册框选；测试结束清理临时数据。测试不会修改正式考试。`test:ai-jobs` 在独立 PostgreSQL schema 验证排队上限、原子领取、供应商并发、worker 身份、心跳过期、任务事件、结果和显式重试，使用注入的测试执行器；该测试不验证真实模型质量。

## Docker 部署与升级

服务器全新部署和 Ubuntu 定时器配置见 [v2 部署指南](docs/deployment.zh-CN.md)；已有 0.1.15 服务器升级见 [升级专用指南](docs/upgrade-from-v0.1.15.zh-CN.md)。

使用 [compose.yaml](compose.yaml) 运行数据库、一次性迁移容器、Web、AI Worker 和 Caddy。Web 镜像包括 Python / OpenCV 扫描运行环境及扫描程序，迁移镜像独立保留 Prisma CLI；AI Worker 镜像包含打包的服务程序及追踪后的 Prisma、AI SDK、Sharp 运行依赖，与 Web 共享数据库和图片存储。按 `.env.example` 填入 `APP_DOMAIN`、`POSTGRES_PASSWORD` 和 `DEPLOY_DATABASE_URL`；生产 `BETTER_AUTH_URL` 应等于实际 HTTPS 站点地址。

```sh
mkdir -p storage tmp
sudo chown 1000:1000 storage tmp
sudo docker compose up -d --build
```

`compose.release.yaml` 可覆盖为发布镜像：Web 使用 `oh-my-paper`，迁移使用 `oh-my-paper-migrate`，AI Worker 使用 `oh-my-paper-ai-worker`。`deploy/update.sh` 拉取并启动这三种镜像；`APP_VERSION` 可固定版本。推送到 `v2` 的每个 commit 都会在 CI 通过后发布 `sha-xxxxxxx` 和 `latest` 镜像；Ubuntu 服务器上的 systemd timer 使用 `sudo` 定时拉取 `latest`。

已有 0.1.15 服务器的切换步骤见 [升级专用指南](docs/upgrade-from-v0.1.15.zh-CN.md)。旧版本发布说明已从 v2 分支移除，不作为 v2 部署步骤。

## AI 任务执行

`POST /api/platform/ai` 校验当前账号和资源权限后将任务存入数据库，任务状态为 QUEUED / RUNNING / COMPLETED / FAILED。独立 AI Worker 原子领取任务，按供应商设置限制并发，并持续写入事件和心跳。心跳超过 90 秒的任务标记失败，由用户明确重试为新任务，避免崩溃后自动重复执行已计费请求。只有失败任务的本人可重试，运行中的任务仍保存在数据库中，网页刷新不影响执行。

开发可分别运行 `pnpm dev:web` 与 `pnpm dev:ai-worker`。部署不要只启动 Web，否则 AI 任务会停留在排队状态。Worker 接收到 SIGINT / SIGTERM 后完成当前任务再退出；部署停止宽限期应覆盖供应商请求超时。真实模型能力和端到端验收单独记录，队列测试的模拟执行器不能替代真实 AI 验收。

AI 六项能力分别为图片试题导入、答案／解析／评分标准／知识点补全、按分布组卷、答题卡制作、逐题阅卷和薄弱知识点推题。每项通过自主 Agent 工具调用检查上下文并提交结构化结果，使用现有业务权限与校验。`test:ai-domain` 检查工具真实持久化，`test:ai-live` 调用已配置供应商模型；只有实际模型完成证据才能确认相应真实 AI 验收。

## 当前验收记录

非 AI 与 AI 软件流程按 PRD 顺序已分别验收，最终检查 57 项测试通过。详见 [验收总表](v2-docs/acceptance.md)、[非 AI 验收](v2-docs/acceptance-non-ai.md)、[AI 验收](v2-docs/acceptance-ai.md)、[浏览器操作](v2-docs/acceptance-browser.md) 和 [界面复审](v2-docs/ui-review.md)。真实外部模型六类任务及混合小问评分证据在 `v2-docs/evidence/`；扫描仪直连待设备到位后完成实机验收。

`pnpm run test:production` 将最新 Web standalone 与 AI Worker 复制到独立临时目录运行，对生产服务执行真实 HTTP 验收，包括角色、考试发布、学生隐私、推荐题配图、统一筛选学情和正式排名。需要先完成 `pnpm build` 与 `pnpm build:ai-worker`，并配置本机数据库。

当前环境没有实体扫描仪；SANE/eSCL 桥接与模拟设备协议已通过测试，实体设备接入与现场印刷尚待实测。Docker 配置和独立生产产物已经核对，本机没有 Docker，因此尚未实际运行镜像。软件验收通过不能替代这些现场验证。
