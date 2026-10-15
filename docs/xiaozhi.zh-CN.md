# 小纸综合助手

登录后进入 `/xiaozhi`。原教学工作台仍在 `/workspace`，两处导航互通。小纸支持会话历史、搜索与重命名、图片/PDF 附件、流式回复、可展开的工具记录、模型选择和个人技能编辑。

## Harness 与长任务

小纸的主循环采用 **Pi Durable 1.2.0**，直接使用 `@earendil-works/pi-durable`、`pi-ai` 和 Chord；不使用 Vercel `ToolLoopAgent`。Pi Durable 目前为实验性 API，因此依赖精确锁定，升级前须重新运行恢复测试。实现依据 [Pi Durable 官方文档](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)。

模型自主选择工具，没有固定教学工作流或步骤数上限。上下文接近上限时由 Pi 压缩；压缩前的可见聊天记录继续保留。默认按 65,536 token 的保守上下文窗口运行，自定义模型可通过 `XIAOZHI_CONTEXT_WINDOW` 调整；管理员应按实际模型容量配置。

运行在独立 AI Worker，页面关闭和 SSE 断开均不终止任务。PostgreSQL 保存用户归属、输入队列、运行租约和界面快照；`STORAGE_ROOT/xiaozhi/<conversation-id>/session.sqlite` 保存 Pi 的任务检查点。部署必须保留整个 `storage` 卷，worker 重启后重新领取会话并恢复同一 Harness；不可只恢复 PostgreSQL 而丢弃 SQLite 文件。生产通过现有 `ai-worker` Compose 服务启动，本地 `pnpm dev` 同时运行 Web 和完整 worker；仅调试小纸时可用 `pnpm dev:web --port 3100` 与 `pnpm dev:xiaozhi`，并把 `BETTER_AUTH_URL` 设置为对应地址。

消息通过唯一 `requestId` 幂等提交。正在处理时可选择「调整当前任务」或「完成后接着处理」，由 Pi 的 steering / follow-up 队列执行。停止会取消 Pi 当前任务及待处理输入；已经成功的业务操作不会回滚。重启时只自动重放标记为安全的工具；HTTP 操作保守标记为不可重放，避免中断后重复创建或发布。恢复模型会得到中断记录，并需先查询结果再继续。网络不确定的业务写入也应先核实，不能直接重复提交。

SSE 通过 PostgreSQL LISTEN/NOTIFY 推送授权快照，重连会读取当前状态；不依赖浏览器持续连接运行 Agent。快照在会话所属账号内隔离；Cookie 只加密保存在服务器，不进入 Pi 提示词、工具输出和客户端快照，任务正常完成后清除。

## 网站能力

`list_capabilities` 提供网站 HTTP 功能目录；`describe_api` 从当前 Zod 契约生成单个命令的参数说明；`website_request` 支持 JSON、CSV 和 multipart。允许访问的路径与方法由明确目录约束，不接受外部地址、路径穿越、重定向或认证接口。目录覆盖题库、题本、班级与学生、考试作业、答题卡、作答、学情、账号导入、管理配置、导出和现有 AI 任务。

每次 HTTP 请求携带当前用户会话，并经过网站原有身份、CSRF、资源归属及实时权限检查。写入会原样返回业务结果，不对成功写入应用模型指定的字段投影。AI 评分只能通过现有 GRADE 任务保存，避免冒充人工评阅。原有专业 AI 任务使用其原本实现，小纸通过网站接口提交并使用 `wait_for_task` 或查询工具跟进状态；排队不等于完成。

`XIAOZHI_WEBSITE_URL` 可指定 worker 访问网站的内部地址。Compose 设置为 `http://web:3000`，CSRF Origin 仍使用 `BETTER_AUTH_URL`。浏览器下载链接只返回相对站内地址。扫描仪采集和浏览器打印需要用户进入相应页面操作，Agent 不持有本机硬件或浏览器控制权限。

## 扩展技能

内置目录为 `skills/xiaozhi/`。新增技能不需要修改 Agent、工具注册或前端代码：

```text
skills/xiaozhi/weekly-lesson/
  SKILL.md
  references/
    checklist.md
```

```markdown
---
name: 每周备课
description: 按学校习惯整理下周课程与练习
---

先核实班级和学科，再读取真实的题库与学习报告。
需要时读取 references/checklist.md。保存后提供结果链接。
```

目录名使用小写字母、数字和连字符；`SKILL.md` 必须有 `name`、`description` YAML 字段，正文为工作指导。`list_skills` 只列摘要，`read_skill` 按需加载完整内容，`read_skill_resource` 读取当前技能目录内的 Markdown、文本、JSON、CSV 参考资料，拒绝目录穿越与指向目录外的符号链接。技能不能改变用户权限或覆盖当前用户指令，也不会自动执行服务器脚本。

`XIAOZHI_SKILLS_DIR` 可增加一个受信任的服务器技能目录，同名目录覆盖内置技能。目录挂载需同时供 Web 和 worker 读取。代码库中的内置技能会打包进 Web standalone 和 worker 制品；新增目录后重新构建部署。外部挂载目录的更新在下一次技能读取时生效；已开始的模型请求仍使用准备请求时的上下文。

用户还可在界面「技能库」中新增、编辑、选用和删除个人技能，记录按账号隔离。选用技能会预先放入下一次运行上下文，其余技能由模型按需读取；运行中须停止后再调整选用列表。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test --maxWorkers=4
pnpm test:xiaozhi # 需要启动 Web，使用当前 .env 的隔离开发数据库
pnpm build
pnpm build:ai-worker
```

新增测试覆盖长工具循环、SQLite 中断恢复与不可重放写入、steering/停止、上下文压缩、全部站内 API 目录覆盖、外部地址拒绝、成功写入的字段投影、技能包与参考文件加载，以及真实 HTTP 的登录/CSRF/跨账号会话、SSE、技能和附件授权。生产验收脚本也包含小纸 HTTP 检查。真实模型已验证自主创建班级并返回网站记录链接；模拟模型测试用于控制恢复场景，不代替模型质量验收。
