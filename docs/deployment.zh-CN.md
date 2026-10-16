# 把 Oh My Paper 部署到自己的服务器

为学校或教研团队建立独立的网站，把题库、作业、考试和学习反馈放在同一个工作空间。推荐使用 Linux 和 Docker Compose，安装完成后在浏览器中管理账号、教学内容和 AI 模型。

## 全新服务器部署

以下使用 Ubuntu 举例。准备一个指向服务器的域名，开放入站 80、443 端口，安装 Git、Docker Engine、Compose、Buildx 插件与 Python 3，并确认服务器能够下载容器镜像、npm 和 Python 依赖。构建与 AI 图片处理会占用资源，请先用少量材料试运行，再按并发量规划配置。

```bash
git clone --branch v2 https://github.com/TaiRuiQu/oh-my-paper.git ~/oh-my-paper
cd ~/oh-my-paper
cp .env.example .env
chmod 600 .env
mkdir -p storage tmp
sudo chown 1000:1000 storage tmp
```

编辑 `.env`，填写下表的项目。示例中的 `paper.example.com` 必须换成自己的域名；所有 `REPLACE_...` 必须替换。

| 配置项                        | 填写方式                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `APP_DOMAIN`                  | 例如 `paper.example.com`，不带协议或路径。                                                               |
| `BETTER_AUTH_URL`             | 例如 `https://paper.example.com`。                                                                       |
| `POSTGRES_USER`               | 例如 `paper`。                                                                                           |
| `POSTGRES_DB`                 | 例如 `oh_my_paper`。                                                                                     |
| `POSTGRES_PASSWORD`           | 独立的随机数据库密码。建议使用随机十六进制值，避免连接字符串转义问题。                                   |
| `DEPLOY_DATABASE_URL`         | `postgresql://paper:你的数据库密码@db:5432/oh_my_paper`，用户名、密码和库名须与上面一致，主机使用 `db`。 |
| `BETTER_AUTH_SECRET`          | 至少 32 字符的随机认证密钥。                                                                             |
| `PROVIDER_KEY_ENCRYPTION_KEY` | 另一份至少 32 字符的随机密钥，用于保存模型访问凭据。                                                     |
| `QDRANT_API_KEY`              | 独立的随机向量数据库访问密钥。                                                                           |

下面的命令每次生成一份 64 字符随机值。为数据库密码、认证密钥、模型凭据加密密钥、向量数据库密钥分别运行一次，不要共用同一个值：

```bash
python3 -c 'import secrets; print(secrets.token_hex(32))'
```

### 从源码启动

这种方式不依赖项目是否已发布公开镜像，适合第一次部署或部署自己的修改：

```bash
sudo docker compose -f compose.yaml up -d --build
sudo docker compose -f compose.yaml ps -a
sudo docker compose -f compose.yaml logs --tail=100 migrate web ai-worker
```

首次构建需要下载并编译组件。看到 `migrate` 成功退出、`web` 健康且 `ai-worker` 持续运行后，打开配置的网站地址。Caddy 会在域名解析正确、端口可达时申请 HTTPS 证书。也可以验证服务响应：

```bash
curl -fsS https://paper.example.com/api/health
```

首次启动日志会显示一次管理员账号和随机密码，请保存后登录。如果日志已轮转，请由维护人员按项目的账号恢复方式处理，不要删除数据库重新初始化。源代码构建可在 `.env` 设置 `APP_COMMIT_SHA` 为 `git rev-parse HEAD` 的完整输出，使页脚显示对应源版本。

### 使用已发布镜像

当维护者已在 GHCR 发布完整镜像时，可避免在服务器上编译。在 `.env` 加入 `APP_VERSION=latest`，然后执行：

```bash
sudo docker compose -f compose.yaml pull db qdrant proxy
sudo bash deploy/update.sh
sudo docker compose -f compose.yaml -f compose.release.yaml ps -a
sudo docker compose -f compose.yaml -f compose.release.yaml logs --tail=100 migrate web ai-worker
```

私有镜像需先执行 `sudo docker login ghcr.io`。更新程序会为数据库迁移、网站与 AI Worker 选择同一组完整发布镜像。只有执行过更新程序、生成本机发布清单后，才使用带 `compose.release.yaml` 的命令；源码构建使用前面的单文件命令，两种方式择一。

## 登录后先做这三件事

1. 在「系统管理」创建教师账号、班级和学生，设置任教与管理身份。
2. 在「AI 模型配置」填写服务地址、访问密钥和模型。图片识别与阅卷请选择支持图片的模型。
3. 用少量虚构试卷测试识别、组卷、批改与打印，确认效果后再导入正式材料。

语义搜索需要单独保存向量化模型、设置输出维度并点击「重建索引」。重建会调用模型并产生费用；未配置语义搜索时仍可使用关键词检索。更换向量模型后需要重新建立索引。

[第一次使用](getting-started.zh-CN.md)提供从建班到第一次讲评的完整操作说明。

## 更新网站

更新前备份数据，保留原来的 `.env`、认证密钥和模型凭据加密密钥。源码部署拉取需要的版本后重新构建：

```bash
git pull --ff-only
sudo docker compose -f compose.yaml up -d --build
```

镜像部署先同步版本对应的 Compose 文件与部署脚本，再运行：

```bash
sudo bash deploy/update.sh
```

镜像部署可以把 `APP_VERSION` 固定为 `sha-` 加完整 40 位提交 SHA，或已发布的标签；`latest` 跟踪最新完整发布。数据库迁移不保证可逆，恢复旧镜像前须确认其与当前数据库兼容，必要时恢复成套备份。

### 可选：自动检查镜像更新

在项目目录执行以下命令，安装每五分钟检查一次的更新服务。只适用于发布镜像部署；固定 `APP_VERSION` 可控制跟踪的版本。

```bash
PAPER_DEPLOY_DIR="$(pwd -P)"
sudo tee /etc/systemd/system/oh-my-paper-update.service >/dev/null <<EOF
[Unit]
Description=OhMyPaper image update
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
User=root
WorkingDirectory=$PAPER_DEPLOY_DIR
ExecStart=/usr/bin/bash $PAPER_DEPLOY_DIR/deploy/update.sh
TimeoutStartSec=30min
EOF
sudo cp deploy/oh-my-paper-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oh-my-paper-update.timer
sudo systemctl start oh-my-paper-update.service
sudo systemctl list-timers --all oh-my-paper-update.timer
```

更新记录可用 `sudo journalctl -u oh-my-paper-update.service -n 100 --no-pager` 查看。自动更新只替换镜像，不同步仓库文件；部署配置变化后仍需由维护人员更新服务器上的文件。停用自动更新：`sudo systemctl disable --now oh-my-paper-update.timer`。

## 备份与恢复

请同时保护数据库、`storage`、Qdrant 数据及 `.env`。题库配图、学生作答、小纸会话文件与数据库共同组成一份可恢复的教学记录。`PROVIDER_KEY_ENCRYPTION_KEY` 丢失后，已保存的模型凭据无法正常解密。

项目提供数据库与 `storage` 的一致性备份脚本，备份期间会短暂停止 Web 和 AI Worker：

```bash
sudo bash scripts/backup.sh /srv/oh-my-paper-backups
```

该脚本不备份 Qdrant 和 `.env`，请另行安全保存。恢复时先停止写入，配套恢复数据库与 `storage`，使用原密钥，再恢复服务；Qdrant 可另做卷快照，或在恢复后重新建立向量索引。备份包含敏感教学数据，应放在受限位置，并定期验证可恢复性。

不要运行 `docker compose down -v` 来更新网站，它会删除数据库等持久卷。

## 常见问题

| 现象                   | 先检查什么                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- |
| 网站无法访问或证书失败 | 域名解析、80/443 端口、防火墙，以及 `proxy` 和 `web` 日志。                           |
| AI 任务一直排队        | `ai-worker` 是否在运行、模型是否启用。                                                |
| 模型请求失败           | 服务地址、密钥、模型名称、余额和服务器出站网络。                                      |
| 语义搜索没有结果       | 向量模型是否配置、维度是否正确、索引是否重建完成。                                    |
| 导出的 PDF 字体不对    | PDF 由本机浏览器打印生成，请检查用户电脑字体与打印预览。                              |
| 扫描仪无法连接         | 先尝试上传图片或 PDF，再按[扫描仪指南](../scripts/scanner-bridge/README.md)检查设备。 |

排查日志时使用与你选用的部署方式一致的 Compose 参数。向他人反馈问题前，移除初始管理员密码、模型密钥、数据库连接和学生材料。

### AI Worker 的沙箱检查失败

AI 图片与文档处理需要 Linux 用户命名空间。Worker 启动时会检查隔离环境，不满足要求时会退出。先确认使用项目提供的 `compose.yaml`，不要给 Worker 开启 `privileged`。

源码部署可直接验收当前镜像：

```bash
sudo docker compose -f compose.yaml run --rm --no-deps ai-worker node --conditions=react-server sandbox-check.mjs
```

发布镜像部署可在已生成本地发布清单后运行：

```bash
sudo python3 deploy/repair-sandbox.py
```

修复脚本会在需要时调整宿主机的用户命名空间限制，包括 Ubuntu 的 AppArmor 全局限制，影响宿主机安全策略；请由服务器维护人员评估，优先使用适合该隔离方式的专用主机。源码部署需由维护人员按实际主机策略配置；修复脚本只支持发布镜像配置。

## 想在本地运行源码

完整 AI 沙箱需要 Linux，Windows 用户建议使用 WSL2。准备 Node.js 24.19+（24.x）、pnpm 11、PostgreSQL 18、Python 3.11+、Poppler、Bubblewrap 和 util-linux，数据库连接填写在 `.env` 的 `DATABASE_URL` 中。

```bash
pnpm install --frozen-lockfile
cp .env.example .env
python3 -m venv .venv
.venv/bin/pip install -c tools/python-constraints.txt -r tools/card-scan/requirements.txt -r tools/sandbox/requirements.txt
pnpm db:generate
pnpm db:deploy
pnpm dev
```

启动前把 `.env` 中的认证与加密密钥替换为随机值。访问 `http://localhost:3000`；`pnpm dev` 同时运行网站与 AI Worker。语义搜索还需要单独启动 Qdrant 并填写 `QDRANT_URL` 与 `QDRANT_API_KEY`。日常修改可运行 `pnpm check` 检查。
