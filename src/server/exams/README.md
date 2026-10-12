# 试卷识别 Agent

`recognition-agent.ts` 负责会话、草稿和工具提交。`recognition/` 将提示词、领域类型、图像查看工具、证据图输出、校验和产物组装分别保存；文件职责与开发检查见 [代码组织说明](../../../docs/code-organization.md)。

`parseExam` 在 Worker/CLI 中准备 PDF 或图片页面后，交由 AI SDK 7 `ToolLoopAgent` 自主识别。HTTP 上传只负责保存和入队。没有 inventory → localization → transcription 的固定模型流程。

Agent 使用 `read_saved`、`read_pages`、`inspect_image`、`read_text`、`rotate_page`、`save_document`、`save_questions`、`revise_question`、`save_annotations`、`review_questions`、`review_annotations` 和 `finish`。它自行决定工具顺序、批量大小、放大范围和纠错方式。图像工具调用受限的 Python Pillow/OpenCV 操作，不能执行模型生成的任意程序、读取其他任务或访问网络。

原生输出是 `recognition.json`：JSON 中的题干、选项、小问、材料和批注使用 Markdown 与 LaTeX，配图使用标准 Markdown 图片引用及独立的来源区域。程序在既有编辑器/批改边界将它适配为 `DigitalExam`；模型不输出 text/math 类型分段。整题、配图和作答裁切图由程序依据通过校验的坐标保存。

`finish` 检查所有页面已查看、分类覆盖、真实题目与答案页分离、题号/排序、材料引用、选项、作答目标和区域。错误作为工具结果返回给同一 Agent 修正。仅参考答案的文档允许零题，并要求保留答案记录。固定题套只提供题号/板块，不向识别 Agent 暴露标准答案。

`agent.jsonl` 持久保存实际公开消息、工具输入、工具结果与耗时，不保存私有推理、API key 或原始提供商异常。网页按游标增量读取；授权预览在完成前即可访问。记录按执行 attempt 隔离，取消或失败后保留。失败重试或 Worker 重放可恢复同一原件哈希对应的已保存草稿，Agent 使用 read_saved/review_questions 自主复查和修正，禁止将另一份文件的草稿套用到本次上传。SDK 步数上限、每步超时和 Worker 的总体超时约束运行；模型调用使用 SDK 的非流式 generate，工具生命周期回调实时更新网页；请求失败由 SDK 重试，已完成工具结果保留在对话中。

识别模型由 `recognition` 配置选择；兼容已有 `inventory`/`exam` 默认值。旧阶段快照仍可读取。可选标准答案生成继续调用独立 `solution` 服务；逐题批改保持现有实现。

```sh
pnpm test
pnpm typecheck
pnpm test:exam-web
pnpm eval:exams --configured --no-answers --student-answers
```

真实样例报告区分结构/证据覆盖与人工逐字准确率，见 [样例验证](../../../docs/exam-parsing-validation.md)。

长文档使用 SDK `prepareStep` 管理当前上下文：较早的工具图片只保留文本/坐标，Agent 可以按需再次查看原件；完整工具记录和源图预览不被删除。单次输出预算最多 8,000 token，题目保存每批最多 4 道；这约束资源占用，不指定工具顺序。SDK 请求重试用尽后可从同一已完成工具对话进行一次恢复，最终仍必须通过 `finish`。

每页元数据声明实际存在的作答、参考答案和批注类型；`finish` 要求对应页存在独立记录，防止仅描述笔迹而遗漏内容。图像材料必须包含在题目、共享材料或作答的完整来源区域内。模型选择任意工具，只有通过校验的 `finish` 才算完成。
