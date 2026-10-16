# OhMyPaper - 面向 K12 教育工作者 / 学生的一站式试卷处理

## 简介

随着大语言模型 (LLM) 与 Agent 的发展，我们可以使用 LLM 来完成试卷的全流程处理，我们想实现的内容包括：

1. 试卷的电子化录入。包括：题目文本、非文本的材料、分值，等等。
2. 答案生成。使用模型自动生成题目对应标准答案。
3. 学生作答批改。使用模型批改学生的答案，并打分。
4. 错题总结、学情分析。根据学生的错题，反馈学生的薄弱点，需要加强的部分等等。

## 系统更新原则

当前系统正在更新，尚未正式发布。任何更改都不需要考虑向后兼容性；应直接采用符合当前需求的设计，不为兼容旧实现保留冗余逻辑。

## 方法论

所有模型工作采用 Autonomous Agent 实现，而不是 Workflow。其中，Autonomous Agent 赋予 LLM 自主决定执行过程、自主获取信息的能力。以 AI 识别试卷为例，工作流程如下：

1. 模型开始工作，明确目标：将试卷电子化录入。
2. 模型查看当前试卷，自主选择调用工具，以尽可能清晰地获取所需上下文。
3. 在模型认为自己获得了足够的上下文后，返回结果，结束 Agent Loop。

## 提交、推送与 CI

每次推送后，必须 watch 对应提交的完整 CI，直到所有必需任务通过，包括校验、Docker 镜像验收与发布，以及镜像清理。使用 `gh run watch <run-id> --exit-status` 跟进；失败时读取日志、修复、验证并重新推送，继续 watch 新提交。不能在 CI 仍运行、失败或取消时将任务报告为完成。GitHub 与 CNB 都需要推送时，确保两端分支指向最终通过 CI 的同一提交。

## 小纸 API Skill 同步维护

小纸的网站 API 技能位于 `skills/xiaozhi/site-api/`。新增、删除或修改网站 API 时，必须在同一次更改中同步维护该技能及其参考资料，包含 HTTP 方法与路径、请求参数、响应格式、认证与权限、错误处理、流式事件和异步任务行为。业务命令、AI 任务或其 schema 变化也属于 API 变化，不能只更新路由目录。

接口文档以当前源码为准；同步区分完整网站接口与小纸 `website_request` 实际允许调用的接口。涉及小纸工具能力时，同时核对 `src/server/xiaozhi/api-catalog.ts`、`tools.ts` 与技能说明，避免把不可调用的接口写成可执行能力。提交前运行 `pnpm run check:xiaozhi-api`（已接入 `pnpm run check`），修复遗漏与过期说明；重新生成清单不能替代对参数、权限和行为说明的人工核对。具体刷新命令见该技能的 `SKILL.md`。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
