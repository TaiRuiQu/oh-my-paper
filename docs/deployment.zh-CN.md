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

只有 Worker 镜像需要 `poppler-utils`（`pdftoppm` / `pdfinfo`）、`bubblewrap` 和预装 Pillow、OpenCV、NumPy、SciPy、SymPy 和 mpmath 的 `/opt/python-sandbox` 虚拟环境。Web 镜像只负责接收上传与投递队列，不做页面渲染。

Worker 的 Node.js 运行目录由 `pnpm run build:worker` 生成到 `build/worker`：编译 Worker、健康检查和 Prisma 配置，追踪实际依赖，并保留迁移文件与 Python 沙箱脚本。镜像仅复制该目录，不复制完整 `node_modules` 或应用源码，也不需要运行时 TypeScript 加载器。Worker 构建独立于 Next.js 构建；数据库迁移仍使用同一个 Worker 镜像，Compose 的启动方式无需调整。

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

每次推送 `v*` tag 且 Lint 通过后，CI 会构建并推送 Web 与 Worker 两个镜像（`linux/amd64`），并同时打上 git tag 与 `latest` 两个标签：

```text
ghcr.io/tairuiqu/oh-my-paper:<tag> 与 :latest
ghcr.io/tairuiqu/oh-my-paper-worker:<tag> 与 :latest
```

仓库已提供 `compose.release.yaml`，覆盖构建行为改为拉取已发布镜像。版本号由 `.env` 中的 `APP_VERSION` 控制，**缺省跟随 `latest`**——配合 §6 的定时器即可全自动升级；需要回滚或固定版本时才设置它：

```bash
# 可选，默认 latest
APP_VERSION=v0.1.2
```

启动：

```bash
docker compose -f compose.yaml -f compose.release.yaml up -d
```

> 若服务器上曾手工创建过 `compose.release.yaml`，请先删除再用仓库内的版本，避免 `git pull` 冲突。

镜像拉取本身就是增量的：Docker 按 layer 内容寻址，基础镜像、apt 软件包、Chromium、Python 虚拟环境等层不变就不会重复下载，通常只有应用层（构建产物与源码）随版本更新。CI 构建也启用了 GitHub Actions 缓存（`cache-from/cache-to: type=gha`），依赖不变时 `pnpm install` 等重头步骤直接复用缓存。

若镜像为私有仓库，先登录 GHCR（定时器与 cron 都使用 root 的凭据）：

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

### 自动升级（推荐）

安装 systemd 定时器，服务器每五分钟检查一次 GHCR：

```bash
# 部署目录不是 /opt/oh-my-paper 时，先修改两个 unit 文件中的路径
sudo cp deploy/oh-my-paper-update.service deploy/oh-my-paper-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oh-my-paper-update.timer
journalctl -u oh-my-paper-update.service -f   # 观察拉取与滚动日志
```

`deploy/update.sh` 依次执行 `pull` → `up -d` → `docker image prune -f`：

- 镜像没有变化时 `up -d` 不做任何事，开销只有几次 manifest 请求；
- 有新版本时，compose 先重建并运行 `migrate`（`prisma migrate deploy`），成功后才滚动重启 `web` 与 `worker`，数据库结构与代码版本始终配套；
- 被 `latest` 抛弃的旧镜像由 `docker image prune -f` 清理；
- `db` 与 `proxy` 使用固定版本镜像，不在自动更新范围内，升级它们应当显式进行。

定时任务只更新镜像，不执行 `git pull`，也不会同步服务器上的 Compose 文件、部署脚本或内核配置。涉及这些文件的版本更新，需要先在服务器上同步对应配置；之后仍可继续使用原定时任务。仅有应用代码和数据库迁移变化时，不需要手动更新。

因此日常发布只需要：

```bash
git tag v0.2.0 && git push origin v0.2.0
```

CI 推送 `:v0.2.0` 与 `:latest` 后，服务器在五分钟内自动跟进。

> 不建议使用 Watchtower 之类的容器自动更新器：它们绕过 compose 直接重建容器，`migrate` 不会在 `web` / `worker` 之前重跑，数据库结构可能与新代码脱节。

不便使用 systemd 时，用 cron 等价替代：

```cron
*/5 * * * * cd /opt/oh-my-paper && ./deploy/update.sh
```

### 手动升级

```bash
docker compose -f compose.yaml -f compose.release.yaml pull
docker compose -f compose.yaml -f compose.release.yaml up -d
docker image prune -f
```

### 回滚

在 `.env` 中临时固定版本，执行一次 `deploy/update.sh`（或上面的手动命令），恢复后再删除该行：

```bash
APP_VERSION=v0.1.2
```

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

**Python 工具报 `bwrap` 失败（`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` 或 `setting up uid map: Permission denied`）** —— 宿主机是 Ubuntu 24.04 及以上时，内核默认开启 `kernel.apparmor_restrict_unprivileged_userns`。它允许创建用户命名空间，但会在其中叠加受限的 AppArmor 标签，拒绝内部的能力使用（配置回环网卡、写 uid_map），即使容器已配置 `apparmor:unconfined` 也一样。沙箱依赖非特权用户命名空间（compose 已为 Worker 配置 `no-new-privileges` / `seccomp:unconfined` / `apparmor:unconfined` 与 `cap_drop: [ALL]`），因此 `python` / `shell` 工具会持续失败，其余功能不受影响。

确认与修复（宿主机执行）：

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns          # 输出 = 1 即中招
sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0   # 立即生效
echo 'kernel.apparmor_restrict_unprivileged_userns = 0' | sudo tee /etc/sysctl.d/99-oh-my-paper-userns.conf
sudo sysctl --system                                          # 重启后仍生效
```

验证（容器内执行，无输出且退出码为 0 即恢复）：

```bash
sudo docker compose exec worker bwrap --unshare-user --unshare-net \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --proc /proc --dev /dev -- /usr/bin/true
```

放宽该 sysctl 会回到 Ubuntu 22.04 及更早的默认行为，属于常见做法；若必须保持宿主机收紧，可改为编写含 `userns,` 规则的 AppArmor profile 挂给 Worker 容器（将 `apparmor:unconfined` 换成 `apparmor:<profile>`）。

**Python 工具报 `bwrap: Can't mount proc on /newroot/proc: Operation not permitted`** —— Docker 默认会屏蔽 `/proc` 下的部分路径。即使 `seccomp:unconfined`、`apparmor:unconfined` 和宿主机用户命名空间配置已经生效，这些覆盖挂载仍可能使内核拒绝 Bubblewrap 在自己的 PID 命名空间内挂载新的 proc 文件系统。先检查实际容器配置（在部署目录执行）：

```bash
sudo docker inspect --format 'SecurityOpt={{json .HostConfig.SecurityOpt}} MaskedPaths={{json .HostConfig.MaskedPaths}} ReadonlyPaths={{json .HostConfig.ReadonlyPaths}}' \
  $(sudo docker compose -f compose.yaml -f compose.release.yaml ps -q worker)
```

若 `MaskedPaths` 或 `ReadonlyPaths` 不是空数组，在服务器 `compose.yaml` 的 **worker** 服务中补齐以下配置：

```yaml
security_opt:
  - no-new-privileges:true
  - seccomp:unconfined
  - apparmor:unconfined
  - systempaths=unconfined
cap_drop: [ALL]
```

`systempaths=unconfined` 必须使用等号。Compose 将它转换成空的 `MaskedPaths` 和 `ReadonlyPaths`，因此它不会出现在 `docker inspect` 的 `SecurityOpt` 数组中。[Docker 文档](https://docs.docker.com/reference/cli/docker/container/run/#optional-security-options---security-opt)说明了该选项；[Compose 修复记录](https://github.com/docker/compose/pull/10110)说明了客户端处理方式。

此设置仅适用于执行 Bubblewrap 的 Worker，保留 `cap_drop: [ALL]` 和 `no-new-privileges`；模型代码仍在 Bubblewrap 的独立用户、PID、网络命名空间和受限文件系统中执行。

修改后需重建容器，单纯 `restart` 不会应用新的安全配置：

```bash
sudo docker compose -f compose.yaml -f compose.release.yaml up -d --no-deps --force-recreate worker
sudo docker inspect --format 'MaskedPaths={{json .HostConfig.MaskedPaths}} ReadonlyPaths={{json .HostConfig.ReadonlyPaths}}' \
  $(sudo docker compose -f compose.yaml -f compose.release.yaml ps -q worker)
# 期望输出 MaskedPaths=[] ReadonlyPaths=[]
sudo docker compose -f compose.yaml -f compose.release.yaml logs --since 2m worker
```

重建后不应再出现 `worker.sandbox.unavailable`，并可用上面的 `bwrap` 命令验证实际挂载。旧定时任务会继续使用已修改的 Compose 文件；只拉取新镜像不会自动修复这项配置。

Worker 启动时会用与真实调用一致的完整参数做一次沙箱自检，环境不可用时在日志输出 `worker.sandbox.unavailable`（含诊断与修复建议）；排查时先 `docker compose logs worker | grep sandbox`。工具失败信息里也会附带对应的修复指引。另注意：沙箱进程意外退出后，下一次调用会自动重建沙箱，`/workspace` 中的临时文件会重置为初始页面，返回的 stdout 会带一行 `[沙箱进程已重启…]` 提示。

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
