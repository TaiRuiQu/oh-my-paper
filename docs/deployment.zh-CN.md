# 部署手册

面向单机 Docker 部署。仓库根目录的 `compose.yaml` 是部署的唯一事实来源，本手册只解释其中隐含的约束。

## 1. 前置条件

| 项目       | 要求                                                                |
| ---------- | ------------------------------------------------------------------- |
| Docker     | 带 Compose v2（使用覆盖文件发布镜像需 v2.24 以上）                  |
| CPU / 内存 | 至少 2 核 / 4 GB。识别与批改由 Worker 执行，内存不足会导致任务超时  |
| 磁盘       | 试卷原文件、页面渲染图与裁剪材料都写入 `storage/`，按每月试卷量预留 |
| 端口       | 80 与 443 需对外可达，Caddy 依赖它们自动签发证书                    |
| 域名       | `APP_DOMAIN` 需已解析到本机公网 IP                                  |
| 架构       | CI 只发布 `linux/amd64`。ARM 主机需自行用源码构建                   |

只有 Worker 镜像需要 `poppler-utils`（`pdftoppm` / `pdfinfo`）、`bubblewrap` 和预装 Pillow 的 `/opt/python-sandbox` 虚拟环境。Web 镜像只负责接收上传与投递队列，不做页面渲染。

## 2. 配置 `.env`

从 `.env.example` 复制后按部署场景增补。**注意 `compose.yaml` 使用的数据库变量名与 `.env.example` 不同**：容器内 `DATABASE_URL` 由 `DEPLOY_DATABASE_URL` 覆盖（`compose.yaml:22`），主机名必须是服务名 `db`。

```bash
cp .env.example .env
mkdir -p storage tmp
```

### 必填

| 变量                                                  | 说明                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 仅 compose 使用。缺省为 `paper` / 无 / `oh_my_paper`；密码为空时 compose 会直接报错中止                              |
| `DEPLOY_DATABASE_URL`                                 | compose 使用。形如 `postgresql://paper:<密码>@db:5432/oh_my_paper`                                                   |
| `APP_DOMAIN`                                          | 指向本机的域名，用于 Caddy 自动 HTTPS                                                                                |
| `BETTER_AUTH_URL`                                     | 站点对外完整地址，如 `https://paper.example.com`。登录校验的 `trustedOrigins` 由它推导，必须与用户实际访问的地址一致 |
| `BETTER_AUTH_SECRET`                                  | 至少 32 字符随机值                                                                                                   |
| `PROVIDER_KEY_ENCRYPTION_KEY`                         | 至少 32 字符随机值。Web 与 Worker 必须相同                                                                           |

生成两个密钥：

```bash
openssl rand -base64 32
```

### 可选

`PDFTOPPM_PATH`、`PDFINFO_PATH`、`BWRAP_PATH` 在镜像内默认就是 `/usr/bin/*`，无需修改。`QUEUE_SCHEMA` 默认 `pgboss`，**Web 与 Worker 必须一致**，否则 Worker 收不到任务。`WORKER_CONCURRENCY` 默认为 2，取值 1–16；它决定同时处理的试卷数量，也直接决定 LLM 并发与 credit 消耗速度。

### 关于 `PROVIDER_KEY_ENCRYPTION_KEY`

后台保存的 AI API key 使用该密钥做 AES-GCM 加密。**上线后不要更换**：更换后已保存的密钥全部无法解密，只能在 `/admin/ai` 逐个重新录入。它需要和数据库备份一起单独留存。

## 3. 发布：使用 GHCR 镜像（推荐）

每次推送 `v*` tag 且 Lint 通过后，CI 会构建并推送 Web 与 Worker 两个镜像（`linux/amd64`）。tag 与 git tag 一致，不生成 `latest`。

```text
ghcr.io/tairuiqu/oh-my-paper:<tag>
ghcr.io/tairuiqu/oh-my-paper-worker:<tag>
```

新建 `compose.release.yaml` 覆盖构建行为，改为拉取已发布镜像：

```yaml
services:
  migrate:
    build: !reset null
    image: ghcr.io/tairuiqu/oh-my-paper-worker:${APP_VERSION}
  web:
    build: !reset null
    image: ghcr.io/tairuiqu/oh-my-paper:${APP_VERSION}
  worker:
    build: !reset null
    image: ghcr.io/tairuiqu/oh-my-paper-worker:${APP_VERSION}
```

在 `.env` 中固定版本号，升级时只改这一行：

```bash
APP_VERSION=v0.1.0
```

启动：

```bash
docker compose -f compose.yaml -f compose.release.yaml up -d
```

若镜像为私有仓库，先登录 GHCR：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <用户名> --password-stdin
```

`!reset` 需要 Compose v2.24 以上。版本更旧时，直接把 `compose.yaml` 中三个服务的 `build:` 段替换为 `image:` 即可。

## 4. 发布：从源码构建

不需要 `compose.release.yaml`，也不需要 `APP_VERSION`：

```bash
docker compose up -d --build
```

镜像会在本机构建，比拉取慢，但可验证当前源码。`compose.yaml` 已为每个服务声明好 `target`（`web` / `worker`），无需额外指定。

## 5. 首次部署

启动后按顺序确认：

```bash
docker compose ps          # migrate 应已 Exited(0)，web / worker 为 healthy
docker compose logs migrate
curl -fsS http://localhost:3000/api/health   # {"status":"ok","database":"ready"}
```

健康检查的判定标准：

- `web` 每 20 秒请求 `/api/health`，该接口会执行一次数据库查询，迁移未完成时不会返回 `ok`。
- `worker` 每 20 秒检查最近 45 秒内是否有心跳。Worker 停止或卡住会转为 `unhealthy`。

### 创建第一个管理员

**第一个注册的账号自动成为管理员。** 应用在写入用户记录之前检查账号总数，为零时将该账号的 `role` 直接存为 `ADMIN`；此后再注册的账号一律是 `USER`。

因此首次启动的顺序是：

1. 浏览器打开 `https://<APP_DOMAIN>/register` 注册**你自己的**账号。
2. 该账号即为管理员，登录后侧边栏会出现「AI 配置」与「用量」入口。
3. 在 `/admin/ai` 添加提供商与模型。模型需支持图片输入，并按需配置「对公众开放」与扣费倍率——**没有公开模型，普通用户无法创建任何任务**。

> **务必在站点对外可访问前完成注册。** 注册是开放的，而管理员归属于「第一个」账号：在这之前被任何人注册，该账号就会获得管理员权限，且应用内没有任何修改角色的入口，只能直接改库：
>
> ```bash
> docker compose exec db psql -U paper -d oh_my_paper \
>   -c "UPDATE users SET role='USER' WHERE email='<抢注的邮箱>';"
> ```

已有账号的部署不受影响：该逻辑只在账号总数为零时触发，不会改变任何现有用户的角色。

## 6. 升级

```bash
sed -i 's/^APP_VERSION=.*/APP_VERSION=v0.2.0/' .env
docker compose -f compose.yaml -f compose.release.yaml pull
docker compose -f compose.yaml -f compose.release.yaml up -d
```

`migrate` 服务会在 `web` / `worker` 启动前自动执行 `prisma migrate deploy`（`compose.yaml:39`），数据库结构升级无需手工介入。

滚动顺序由 `depends_on` 保证：迁移成功后才重启 Web 与 Worker，因此结构变更与代码版本始终配套。

Worker 配置了 40 秒 `stop_grace_period` 与 35 秒优雅退出期限，正在处理的任务会等当前批次结束。**但强杀 `docker compose down` 仍可能中断试卷解析**——中断的任务在数据库中保留草稿，重试会从草稿续跑，已消耗的 credit 不退还。

## 7. 备份

需要同时备份三项，缺一不可：

| 对象             | 位置                                      |
| ---------------- | ----------------------------------------- |
| PostgreSQL       | compose 卷 `postgres`                     |
| 试卷文件与材料图 | 宿主机 `./storage`                        |
| AI 密钥加密密钥  | `.env` 中的 `PROVIDER_KEY_ENCRYPTION_KEY` |

```bash
docker compose exec db pg_dump -U paper -d oh_my_paper -Fc > backup.dump
tar czf storage-$(date +%F).tar.gz storage/
```

`./tmp` 是临时目录，不必备份。恢复时必须三份一起还原，且顺序为：数据库 → storage → 保持原加密密钥。**用新密钥解密旧备份会导致所有已保存的 AI 密钥失效。**

## 8. 故障排查

**任务一直排队，Worker 无日志** —— `QUEUE_SCHEMA` 在 Web 与 Worker 之间不一致。两者从同一个 `.env` 读取，若手工覆盖过环境变量，检查 `docker compose exec web printenv QUEUE_SCHEMA` 与 Worker 的输出是否相同。

**Python 工具报 `bwrap` 失败** —— 沙箱依赖非特权用户命名空间。compose 已为 Worker 配置 `no-new-privileges` / `seccomp:unconfined` / `apparmor:unconfined` 与 `cap_drop: [ALL]`（`compose.yaml:59-65`）。若你的宿主机内核禁用了非特权命名空间（常见于部分 VPS 与 rootless 限制环境），`python` 工具会持续失败，其余功能不受影响。

**上传报渲染失败** —— 仅 Worker 渲染页面。确认 Worker 存活，且 `PDFTOPPM_PATH` / `PDFINFO_PATH` 指向镜像内实际路径。

**Web 启动即报 `Invalid environment variables`** —— `src/server/config/env.ts` 用 Zod 校验。`BETTER_AUTH_SECRET` 必须至少 32 字符且不以 `REPLACE_` 开头；错误信息只列出变量名，不会回显取值。`PROVIDER_KEY_ENCRYPTION_KEY` 的同类校验在 `src/server/ai/credentials.ts`。

**排查日志** —— Web 与 Worker 均输出 JSON 格式诊断记录，已过滤凭据。浏览器侧另有 `instrumentation-client.ts` 记录网络、资源与未处理异常。面向用户的接口失败会返回 `X-Error-Id` 响应头，可直接用它关联服务端日志。

## 9. 安全须知

- **注册是开放的**，`/register` 无需邀请即可创建账号，每个新账号初始获得 100 credit。若部署在公网且不希望开放注册，需要自行在反向代理层拦截该路由。
- **管理员归属于第一个注册的账号。** 公网部署应在开放访问前完成管理员注册，否则先到者获得管理员权限。补救方式见 §5。
- 用户角色无法通过客户端请求伪造（`role` 标记为 `input: false`），管理员判定每次都实时读库。
- 试卷文件、页面图像与工具轨迹仅对试卷所属管理员开放；普通用户的接口响应中不包含工具调用与草稿内容。
- API key 使用服务端 AES-GCM 加密存储，不下发到浏览器。
- `PROVIDER_KEY_ENCRYPTION_KEY` 与 `BETTER_AUTH_SECRET` 不应提交进版本库，`.gitignore` 已排除 `.env`。
