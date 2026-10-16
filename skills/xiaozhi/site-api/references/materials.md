# 材料、扫描、模板与导出

所有HTTP接口要求登录；除特别说明，写操作需教师或ADMIN、同源Origin。`website_request`只能复用本站授权资产作为multipart文件；当前小纸对话附件保留原始字节。原PDF可用files:[{field:"file",assetUrl,name:"材料.pdf"}]送platform/materials，获取分页PNG后用于IMPORT/GRADE；也可在可用的sandbox中自主处理。

试卷 `instructions` 与 `layout.textBlocks[].text` 的共享阅读图片在 `paper.save` 时按真正Markdown图片节点提取并逐图校验归属，保存内部可信清单；该清单不能由客户端指定，也不作为Paper DTO返回。仅当前可见题本或教师独立阅卷范围内的题本可据此读取材料，学生仍限本人已发布结果／本人有权题本；未发布、撤权或无关第三方旧文本不会产生图片授权。既有未校验阅读文本的数据迁移仅保留同题本所有者的受控引用。普通链接、代码和无关元数据不成为新保存材料的图片授权。共享文章按 `beforeQuestionId` 的原题／题目项锚点显示，卷首说明、无锚及失效锚材料保留在卷首；完整作答反馈和教师阅卷都可读取这些已授权材料。

### POST /api/platform/assets

multipart `file`，保存单张配图；仅教师/ADMIN。只支持可解码PNG/JPEG/WebP，转为PNG，PDF走materials。原图最大30000000字节、解码像素上限50000000；路由Content-Length超过32000000提前413。响应 `{id,url}`，url为 `/api/platform/assets/{id}`。

### GET /api/platform/assets/{id}

私有图片读取先按当前会话的题目、题本、已发布本人结果或教师独立阅卷范围确定可见内容，再识别其中引用。除 `content.images` 外，也识别题干、选项、标准答案、解析、rubric 和子题这些既有授权内容中的精确 `/api/platform/assets/{UUID}` 引用；不接受外部域名、查询/fragment、编码路径或其他对象元数据。inline-only 旧文本还要求图片属于该题目快照/题本所有者，不因猜到其他人的图片 URL 而建立访问关系。题目/题本保存对所有上述引用按现有 `assertAssets` 校验，普通教师不能引用其他人的私有图片；ADMIN维持既有全站资产管理权限。通过校验的inline引用保存时归入content.images，去重后最多20张，确保管理员合法引用也可被题目授权读者查看。未发布、越班/越学科、已撤销授权或仅隐藏评阅记录中的图片仍不可读；学生不获得教师独立阅卷范围。未授权/不存在为404，匿名401；响应仍为私有、禁止缓存，不经公开图片代理。

授权资产原始二进制（含对话原附件），Content-Type为资产类型、private/no-store、nosniff；本人/ADMIN或授权数据引用的资产可读，见调用规则。已校验保存的课堂教案配图使用不可变可信assetUrls索引，再按当前课堂权限逐次核验；合法同班同课代课、教务管理者或实际历史授课者可读获授权教案的历史配图，学生与无权教师不可借题目ID或猜图片UUID读取。小纸查看内容用view_image，website_request的GET只给下载链接，不能因此声称看过图。

### POST /api/platform/materials

multipart `file`（图片/PDF）、`maxPages`（默认100，整数1..100）。仅教师/ADMIN；每文件最多30MB，Content-Length超过32000000提前413。PDF逐页保存为PNG。响应 `{id,url,pages:[{id,url,name,size,page}],pageCount}`，顶层id/url只是第一页；导入整份材料必须使用pages数组的页序。识别试卷IMPORT每任务最多20页，与材料可上传100页是不同限制。

### POST /api/platform/scan

multipart字段：assessmentId、paperId、rosterRevision（当前名单版本正整数）、kind=CARD|WORKBOOK；可选templateId、studentId、boxes（JSON）、sources（JSON）。文件字段为可重复的 `files`。sources 为有序数组，每项 `{assetUrl}` 或 `{fileIndex}`；fileIndex从0开始，且所有上传files必须恰好各引用一次；不提供sources时按files顺序。小纸已有附件优先fields.sources=`JSON.stringify([{assetUrl},...])`，不用重复上传。

本批最多100页、150000000字节（PDF展开后仍校验），单文件最多30000000；Content-Length超过155000000提前413。仅教师/ADMIN；考试、试卷、学生须在授权范围；已发布考试、名单未确认或版本过期409。学生须本次该科REQUIRED，应按快照考号而非当前班级考号识别；缺考/免考/退出不得扫描。返回 `{ids,imported,issues:[{file,error,sourceUrl?}]}`；允许部分成功，HTTP200不等于每页成功，必须核对issues。

CARD：必须选择对应paper的templateId，按每位学生连续页码顺序上传；无学生覆盖值时由六位考号识别，可选studentId手工指定；缺页、重复页、跨学生顺序等记issues。WORKBOOK：必须指定studentId及boxes，boxes每项 `{itemId,page,x,y,width,height}`，归一化坐标、页码从1开始；每道题至少一个区域，每题最多30个、全卷最多500个；同一题可同页或跨页多框，按boxes数组顺序合并为一份作答的有序images，不能使用多个同itemId作答对象。page不能超材料数。全部上传页须成功处理，任何续答页失败时不得保存该学生的残缺答卷；无框的附加页仍保留为sourceFiles。alignment.workbookRegions保留有序坐标，answer.box/sourcePage指向首个区域，完整作答图片从images读取。HOMEWORK只允许WORKBOOK。

该接口负责录入作答与客观扫描处理；需要AI自主批改用GRADE，勿把导入成功当成完整评分完成。同一学生已有评阅的答卷不能覆盖。识别问题页可能留存sourceUrl用于查看与重传。HTTP成功响应中的 imported 与 issues 应分别处理；部分成功后原批次已处理，不能因随后读取列表失败而重传整批。只重新选择失败学生的完整页组，避免再次替换已成功答卷。submissions 的 REVIEW 是评阅进度；扫描异常应读取保存的 alignment.needsReview，而非按 REVIEW 状态推断。

### POST /api/platform/templates

JSON `{paperId,presetId?}`（默认JSON上限16384字节）。按试卷确定性生成并保存答题卡，响应 `{id}`；教师/ADMIN且需试卷写权限，仅EXAM。当前实现接受presetId但没有使用它选模板，不承诺切换预设。复杂自定义可describe_api(template.save)；需要自主设计则用AI TEMPLATE。

### POST /api/platform/revision-papers

JSON `{studentId,name,subject,sources:[{assessmentId,itemId}]}`，可describe_api(revision-papers)；上限150000字节，sources1..500且来源二元组唯一。支持学生本人和授权教师/ADMIN，源错题必须仍可见且学科一致。响应201 `{id,count}`；生成原题重做题本并保存题目快照与配图。空可用错题422。与CONSOLIDATE（从候选题库组巩固题本）区分。

### GET /api/platform/print

query二选一：`paperId`或`templateId`，不能同时有或同时无；必须在当前state可见。试卷/作业 `paperId,format=docx` 返回Word二进制；答题卡 `templateId,format=svg,page?` 返回某页SVG，page默认1且不能超layout.pageCount。format=pdf明确400，PDF通过题本导出页浏览器“打印/保存PDF”。不支持通过此API设置答案开关等未声明参数。

成功Content-Disposition为attachment，private/no-store；website_request返回downloadUrl。链接仍需登录，下载时重新鉴权；不能承诺链接对外公开。

### GET /api/platform/barcodes

query `classroomId`、`copies`（默认1，整数1..20）。仅教师/ADMIN且班级可见，班级不能为空、每个学生考号须1..6位数字（自动补到6位），总标签<=4000。返回 `{pages:string[]}`，每项为可打印条码页HTML；它不是下载链接或PDF。没有渲染工具时提供网页相应入口，不编造已输出可打印文件。

## 扫描页面的本机桥接接口

扫描页面还可连接用户电脑上的独立桥接服务，默认 `http://127.0.0.1:17863`。它不是网站 `/api` 路由，不在 `website_request` 目录内，沙箱也不能访问用户本机硬件。用户需在扫描页面配置桥接地址和令牌并操作采集；小纸不能声称已经启动真实扫描仪。

| 方法与路径          | 请求与响应                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /devices        | 返回 `{devices:[{id,name,backend,unavailable?}]}`                                                                                                                                     |
| POST /scan          | JSON `{deviceId,resolution?:300,source?:"Platen",duplex?}`；返回单页 PNG/JPEG 二进制；由网页上传                                                                                      |
| POST /scan-batch    | JSON `{deviceId,resolution?:300,source?:"Platen",duplex?:false,maxPages?:1}`；返回 `{pages:[{mime,data:base64}]}`；自动进纸需显式传 `source:"Feeder"`，eSCL 支持多页，SANE 每次仍单页 |
| OPTIONS（任意路径） | 允许的 Origin 返回 204 与 CORS 头；不要求扫描令牌                                                                                                                                     |

除预检外要求 `X-Scanner-Token`，缺失或错误 401；提供的 Origin 必须在桥接启动配置中，否则 403。POST 请求体必须为 1..8192 字节；扫描参数、设备或处理错误返回 503 `{error}`，未知路径 404。具体设备能力与分辨率以扫描页面及桥接实际校验为准，不能把图片导入验收当作真实硬件采集成功。

源码：`src/app/api/platform/`对应route、`src/server/platform/{assets,uploaded-pages,scan-sources,scan-upload,cards,revision-papers,word-export,print,barcodes}.ts`、`src/contracts/{uploads,revision-papers}.ts`、`scripts/scanner-bridge/{bridge.py,README.md}`。
