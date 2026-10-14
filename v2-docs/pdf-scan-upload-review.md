# 扫描材料 PDF 与侧栏间距验收

2026-10-14。本次按用户补充限定范围：PDF 用于纸质扫描材料，题目配图和答题卡题区配图继续只支持图片。

## 实现范围

- 题库的试卷扫描识别入口支持 PNG、JPEG、WebP、PDF。PDF 按原页码转换为图片后交给现有自主 Agent；单次识别沿用 20 页上限，不改 Agent Loop。
- 考试答题卡扫描及作业／练习册作答录入支持图片和多页 PDF 混合。PDF 页面按顺序展开，答题卡仍按模板页数合并学生答卷；练习册可逐页预览并人工框选。
- 新增 `/api/platform/materials` 接收扫描材料。`/api/platform/assets` 继续处理配图，后端明确拒绝 PDF。
- PDF 使用本机 Poppler 渲染，最长边 3508px，按页保存为私有 PNG 资产。渲染临时目录在成功或失败后删除；持久化失败撤销该次已保存页面。材料接口返回每页 URL、原文件页码及文件名。
- PDF 预览页面在扫描提交时引用已有资产，无需二次上传；后端验证资产归属并保留混合页面顺序。移除一页后删除该页的框选区域，后续区域页码随之调整。
- 每个源文件最多 30MB；一次扫描展开后最多 100 页、150MB。无效、需密码或超过限制的 PDF 返回可读错误。
- Web Docker 镜像增加 `poppler-utils`；`pnpm run doctor` 检查 `pdfinfo`、`pdftoppm`。
- 侧栏分组标题与展开的第一项之间增加 2px 间距。间距与分组展开／收起一起动画，收起后高度和间距均为 0，与小类之间的间距一致，两个高亮区域不再相连。

## 验证

- `pnpm check`：格式、ESLint、TypeScript 和 89 项测试通过。PDF 专项验证真实两页文件、页码顺序及像素、图片兼容、空／损坏／过大／超页 PDF、配图拒绝 PDF，以及混合扫描页面提交顺序。
- `pnpm test:scan`：在真实隔离 PostgreSQL 中完成多页 PDF 答题卡栅格化、考号匹配、选择题识别、全题裁切与保存；PDF 页面预览资产复用、练习册第二页人工裁切、私有页面引用权限通过。原有 PNG、透视旋转、多页乱序和重传保护仍通过。
- `pnpm test:http`：扫描材料 PDF 返回有序私有页面；学生不能上传、不能读取教师未授权 PDF 页面；配图 API 拒绝 PDF；页数上限生效，原图片业务闭环通过。
- 浏览器实际上传 `examples/数学_仅试题.pdf`，显示两页；第二页预览为 3508×2547，框选区域在正确页面显示。移除第一页后原第二页区域移至第 1 页。题库识别选择器接受 PDF，配图选择器仍只接受图片。
- 浏览器测得侧栏标题与第一项间距 2px，全部分组收起时折叠区高度 0、margin-top 0。
- `pnpm run doctor` 全部通过，包含本机 Poppler；生产构建通过。未执行外部模型或实体扫描仪任务。

## 证据

- [侧栏间距](evidence/pdf-scan-upload/omp-sidebar-spacing-after.png)
- [PDF 第二页预览与框选](evidence/pdf-scan-upload/omp-pdf-workbook-page2.png)
- [试卷识别 PDF 选择](evidence/pdf-scan-upload/omp-pdf-import-input.png)

生产 standalone 服务已重启，健康检查返回 200；重启后再次验证侧栏间距为 2px，完整 HTTP 验收（含 PDF 材料与配图拒绝 PDF）通过。没有运行外部模型或实体扫描仪任务。
