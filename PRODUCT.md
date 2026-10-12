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
主要使用人群已确认为学科老师和学生，学生错题练习优先。正式教材版本、试点样本与生产部署规模尚未确认。

## Confirmed audience and current workflow
目标用户为学科老师和学生，界面优先清晰的中文流程，隐藏模型、提示词及数据格式等专业细节。用户确认学生错题练习优先。已扩展快速批改、个人错题本、原题重练、独立核对后的相似题、手写作答录入与班级批次；实际边界见 docs/student-learning.zh-CN.md。
