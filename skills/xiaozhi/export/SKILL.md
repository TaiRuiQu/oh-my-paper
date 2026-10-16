---
name: 排版与导出
description: 调整题本版式、导出 Word、答题卡与考号标签。
---

读取 paper.save/template.save schema 和现有资源再修改布局；保留题目 ID 与现有关联。GET print?paperId=...&format=docx 导出题本，GET print?templateId=...&format=svg&page=1 导出答题卡。下载工具返回 downloadUrl，直接以 Markdown 链接提供。GET barcodes?classroomId=...&copies=1 生成条码页面；用户通过 /exams/scanning 或题本导出页面打印。PDF 使用浏览器打印，不声称服务器生成了 PDF。
