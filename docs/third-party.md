# 当前第三方运行组件

v2 使用 Next.js / React、Prisma PostgreSQL adapter、Better Auth 和 AI SDK。数学预览与试卷打印使用 KaTeX，打印输出为 MathML；图像处理使用 Sharp；答题卡定位、透视矫正与涂卡读取使用 OpenCV 和 NumPy。

各依赖许可随相应 npm / Python 包分发。部署镜像保留运行依赖及其包内许可文件，独立 AI Worker 的运行依赖由 `@vercel/nft` 追踪复制。

旧版 Word / OMML 导出、浏览器服务器端 PDF 导出、Python 沙箱和 DocCornerNet 模型已从 v2 移除；历史发布文档描述旧版本能力，不代表当前运行依赖。当前打印由浏览器完成，服务器无需 Chromium 或专用宋体资产。
