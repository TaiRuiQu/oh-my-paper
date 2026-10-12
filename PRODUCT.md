# Oh My Paper

<!-- impeccable:product-schema 1 -->

## Platform
web

## Product Purpose
将上传的试卷识别为可核对、可下载的数字试卷。用户已确认采用“上传试卷 → 查看进度 → 核对结果/下载”的流程。

用户随后要求继续集成 AI 批改：以已识别试卷和作答为入口，可补充参考答案与评分标准，查看逐题报告并人工核对分数。

## Capabilities and Constraints
现有 Next.js 项目采用登录账号和工作空间。试卷输入支持 PDF、JPG 和 PNG，识别服务保留原图、题目、公式、表格、配图和独立的作答/批注。管理员可配置常见 AI API 协议、base URL、API key 和自定义模型。密钥只在服务端使用。

## Brand Commitments
用户已确认沿用现有简洁界面和中文交互。

## Open Decisions
主要使用人群和部署规模尚未确认。当前范围包括试卷识别与 AI 批改，错题练习属于后续功能。
