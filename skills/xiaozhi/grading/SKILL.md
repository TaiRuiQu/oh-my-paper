---
name: 扫描与阅卷
description: 录入扫描材料、制作答题卡、启动批改和检查评分。
---

读取 exams/homework state?scope=reviewing，按真实题目与答卷进行评阅。上传附件的 asset URL 可传入 AI IMPORT/GRADE，或 scan 的 multipart sources（JSON 数组，每项 {assetUrl}）。模板可用 POST templates 生成，或 TEMPLATE AI 任务。使用现有 GRADE 自主任务进行 AI 批改，保留 AI 来源与双评规则；不得把模型建议伪装成人工 review.save。异步任务只报告已提交/运行状态，GET ai/{id} 核实完成后才报告结果。任务链接 /workspace/ai/{id}。本机扫描硬件与浏览器打印需要用户在对应页面操作，说明所需操作并给入口。
