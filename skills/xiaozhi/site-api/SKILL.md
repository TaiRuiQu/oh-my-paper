---
name: site-api
description: 查询 OhMyPaper 全站 HTTP API、认证权限、请求响应、业务命令和异步任务语义，选择小纸实际可用的站内工具执行题库、组卷、作答、分析、导出或管理操作。
---

# 全站 API 与小纸调用参考

这是当前网站的 API 参考，覆盖全部显式 Route Handler（包括前端专用接口）。它不赋予额外工具或权限。通过 `read_skill({id:"site-api"})` 加载本技能，按目标读取所需资源，自主决定查询、调用和结束时机。当前用户身份由会话上下文提供；需要刷新身份或数据范围时读取授权网站数据。API发现依靠本技能，不再提供一次性返回完整目录的工具。

资源通过 `read_skill_resource({id:"site-api",path:"references/文件名.md"})` 按需读取：

| 任务                                                    | 资源                                     |
| ------------------------------------------------------- | ---------------------------------------- |
| 工具参数、HTTP 与工具的边界、权限、错误、重试与授权     | [调用规则](references/calling.md)        |
| 页面数据、题库检索、学情分析、16 个业务命令及其请求结构 | [业务数据与命令](references/platform.md) |
| 学年学期、课程任课、课表校历与师生课程                  | [教务与课程](references/school.md)       |
| 备课、教案确认、课堂名单、出勤与授课记录                | [备课与课堂](references/teaching.md)     |
| 线上作业发放、学生草稿、提交、退回重交、收交统计        | [作业收交](references/homework.md)       |
| 自主练习、保存提交、反馈核验与独立练习证据              | [自主练习](references/practice.md)       |
| 9 类 AI 任务、状态、重试、SSE 进度                      | [自主 AI 任务](references/ai.md)         |
| 图片/PDF、扫描、答题卡、原题复习卷、Word/SVG/条码       | [材料与导出](references/materials.md)    |
| 管理员配置与账号批量导入                                | [管理 API](references/admin.md)          |
| Better Auth catch-all 内的32条库路径及输入/响应schema   | [认证子路由](references/auth.md)         |
| 对话、消息、附件、技能管理、认证与健康检查              | [前端与基础接口](references/frontend.md) |
| 精确路径、方法、源码文件、参考文档位置                  | [机器可读清单](references/routes.json)   |

JSON 参数以 `describe_api({operation:"操作名"})` 返回的实时 schema 为准；`describe_api({operation:"operations"})` 列出所有操作。引用中给出常用字段与不能从 JSON Schema 表达的业务约束，不要把概述当作允许漏填字段的依据。

`website_request` 只能调用目录内的 `/api/platform/...` 的 GET/POST/PUT；SSE、`/api/xiaozhi/...`、`/api/auth/...`、`/api/health` 是已记录但不可经该工具调用的接口。查看图像用 `view_image`，原文件附件在会话提供的 `sandbox` 中按需读取/渲染，也可复用原文件资产送材料接口转换；等待 AI 用 `wait_for_task`。没有通用 fetch、文件系统、浏览器工具时，不得假定自己可直接操作这些前端接口。

写操作必须符合当前用户的请求范围。保留现有技能的操作授权规则；用户未要求时不得修改角色、教学权限、模型密钥或删除供应商。AI 评分只能由 `GRADE` 自主任务保存，不能调用 `review.save` 冒充人工评阅。网络中断后先查记录再决定是否重试；任务入队与实际完成必须区分。

双评未由两位不同真人完成前，网站与工具都只提供本人的评分；轮次占用与可执行状态从不含分数的 `reviewAssignments` 读取。不得将隐藏的他人记录当作无人评分，也不能从报告或汇总推断未开放的分数。具体响应和开放条件见[业务数据与命令](references/platform.md)。

维护者：修改 API、输入 schema、权限或相关实现时先同步相应参考文档，如更改认证插件或升级Better Auth，先核对[认证子路由](references/auth.md)与提取器中的插件配置，再执行 `node skills/xiaozhi/site-api/scripts/auth-catalog.mjs --write` 更新认证schema分片。再执行 `python3 skills/xiaozhi/site-api/scripts/audit.py --write` 刷新源码指纹，随后执行 `python3 skills/xiaozhi/site-api/scripts/audit.py --check`。指纹只用于发现变更，不代替人工核实语义。脚本不是小纸运行时工具。

源码指纹统一使用 UTF-8、LF 换行和 POSIX 相对路径，在 Windows 与 Linux 检出同一源码时保持一致。
