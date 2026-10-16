import "server-only";
import { z } from "zod";
import { commandSchema } from "@/server/platform/schemas";
import { adminCommandSchema } from "@/server/platform/admin";
import { aiRequestSchema } from "@/contracts/platform-ai";
import { replayPaperSchema } from "@/contracts/revision-papers";
import { accountImportSchema, importResultSchema } from "@/contracts/account-import";
import { RequestError } from "@/server/http/errors";
import { schoolCommandSchema } from "@/contracts/school";
import { teachingCommandSchema } from "@/contracts/teaching";
import { homeworkCommandSchema } from "@/contracts/homework";
import { practiceCommandSchema } from "@/contracts/practice";

export const apiCatalog = [
  {
    path: "/api/platform/practice/sources",
    methods: ["GET"],
    description:
      "自主练习合法来源；按当前身份返回教师可发布题本或学生本人已有答案的复习题本，query分页。已有答案来源不能标为首次未见答案。",
  },
  {
    path: "/api/platform/practice/sets",
    methods: ["GET"],
    description:
      "按当前班级与学科权限分页读取已发布练习；学生题面白名单不含标准答案，无正式成绩也可使用。",
  },
  {
    path: "/api/platform/practice/sets/{id}",
    methods: ["GET"],
    description:
      "练习发布详情；学生只读已授权安全题面，教师按当前班级学科权限管理，关闭不删除已有作答历史。",
  },
  {
    path: "/api/platform/practice/sets/{id}/preview",
    methods: ["GET"],
    description:
      "教师练习发布预检；id为原Paper ID，返回题目版本及需明确选择的学生可见材料，不创建发布或作答。",
  },
  {
    path: "/api/platform/practice/sessions",
    methods: ["GET"],
    description:
      "自主练习记录分页；学生限本人，教师限当前授权的已提交记录，学生草稿正文不向教师公开。",
  },
  {
    path: "/api/platform/practice/sessions/{id}",
    methods: ["GET"],
    description:
      "本人练习详情与当前尝试；未明确开放参考时不返回参考答案，显式开放先记录曝光，教师只读当前授权已提交快照。",
  },
  {
    path: "/api/platform/practice/sessions/{id}/history",
    methods: ["GET"],
    description: "只读练习历史及不可变提交和反馈版本，按当前权限与分页裁剪；教师不能读未提交草稿。",
  },
  {
    path: "/api/platform/practice/sessions/{id}/assets",
    methods: ["POST"],
    description:
      "学生上传本人练习草稿作答图片，multipart file≤30MB。上传成功不等于草稿保存或提交。",
  },
  {
    path: "/api/platform/practice/reviews",
    methods: ["GET"],
    description:
      "教师按当前班级学科读取已提交练习及核验记录，query classroomId/subject/beforeId/limit；按当前提交时间降序，beforeId为attemptId，包含已核验记录，不返回未提交草稿。",
  },
  {
    path: "/api/platform/practice/reviews/{id}",
    methods: ["GET"],
    description:
      "教师核验已提交练习，id为PracticeAttempt ID；按当前班级学科授权，不授予题库或学生草稿权限。",
  },
  {
    path: "/api/platform/practice/evidence",
    methods: ["GET"],
    description:
      "读取可追溯练习证据，区分首次未见答案、复现、自评、AI候选与教师核验；不改变或混入正式考试成绩。",
  },
  {
    path: "/api/platform/practice/commands",
    methods: ["POST"],
    description:
      "自主练习practice.*命令，以describe_api查询实时schema；CAS保护草稿，UUID固定提交回执，看参考答案先记曝光，反馈更正保留历史。",
  },
  {
    path: "/api/platform/homework/assignments",
    methods: ["GET"],
    description:
      "线上作业发放列表，query assessmentId/status/limit/beforeId；学生仅本人任务，教师按当前班级学科授权，列表不含草稿。",
  },
  {
    path: "/api/platform/homework/assignments/{id}",
    methods: ["GET"],
    description:
      "线上作业详情，id为发放ID。学生仅本人草稿/提交与题体白名单，未发布标准答案不下发；教师收交统计与已交记录，不读学生草稿。",
  },
  {
    path: "/api/platform/homework/assignments/{id}/preview",
    methods: ["GET"],
    description:
      "教师发放预检；此路径id为原Assessment ID。返回名单版本、题目版本、可选题面图及阻止原因，不发放、不改变成绩发布。",
  },
  {
    path: "/api/platform/homework/assignments/{id}/history",
    methods: ["GET"],
    description:
      "线上作业只读历史；query workId/beforeId/limit。按当前权限裁剪提交轮次、退回和收交事件，不含未发布评分或他人草稿。",
  },
  {
    path: "/api/platform/homework/commands",
    methods: ["POST"],
    description:
      "线上作业homework.*命令，describe_api查询schema。发放/收交与成绩发布独立；草稿CAS、提交固定版本与幂等requestId、退回保留旧轮次及评分。",
  },
  {
    path: "/api/platform/homework/works/{id}/assets",
    methods: ["POST"],
    description:
      "学生向本人可作答作业项上传单张作答图；multipart file，上限30MB。返回{id,url}仅完成上传，不等于保存草稿或提交。",
  },
  {
    path: "/api/platform/teaching/sessions",
    methods: ["GET"],
    description:
      "授权备课与课堂列表。query termId/startDate/endDate/status/limit/beforeId；仅教师或管理员，学生403。仅读取已建立课堂，GET不自动建档。",
  },
  {
    path: "/api/platform/teaching/sessions/{id}",
    methods: ["GET"],
    description:
      "课堂详情，含绑定发布课次、当前课表变化、版本化教案、持久名单和出勤、操作能力及阻止原因。仅当前授权课堂教师或管理者。",
  },
  {
    path: "/api/platform/teaching/sessions/{id}/roster-preview",
    methods: ["GET"],
    description:
      "课堂名单核对预览。返回当前班级候选、增减对照及fingerprint；仅授权教师。GET不确认、不改名单。",
  },
  {
    path: "/api/platform/teaching/sessions/{id}/history",
    methods: ["GET"],
    description: "授权课堂版本与教案历史。query beforeVersion,limit；只读，不修改已授课记录。",
  },
  {
    path: "/api/platform/teaching/commands",
    methods: ["POST"],
    description:
      "备课与课堂命令，以teaching.*为操作名查询describe_api。修改携带期望版本，冲突409须显式核对；AI只保存备课候选，不代教师确认或点名上课。",
  },
  {
    path: "/api/platform/roster-history",
    methods: ["GET"],
    description:
      "名单变更只读历史。query assessmentId 必填，beforeRevision?，limit=1..50默认20。仅教师/ADMIN且按当前班级学科授权裁剪，不返回raw audit JSON；学生403。",
  },
  {
    path: "/api/platform/school/state",
    methods: ["GET"],
    description:
      "授权教务状态。管理者含学年/学期/课程/教室/开课和草稿；师生仅含本人可用学期和发布版本。",
  },
  {
    path: "/api/platform/school/commands",
    methods: ["POST"],
    description:
      "教务命令school.year.save/term.save/course.save/room.save/offering.save/timetable.save/timetable.publish；仅ADMIN或学校总管理，使用期望版本，不能自动重放冲突。",
  },
  {
    path: "/api/platform/school/timetable/check",
    methods: ["GET"],
    description: "教务管理者预览已保存草稿的实际课次/资源冲突/周课时告警。query:termId；不发布。",
  },
  {
    path: "/api/platform/school/schedule",
    methods: ["GET"],
    description:
      "按本人权限读取已发布实际课次。query:termId,startDate,endDate（学校日期）；未发布草稿不会出现在课程中。",
  },
  {
    path: "/api/platform",
    methods: ["GET", "POST"],
    description:
      "完整的授权数据，未完成人工双评仅返回本人评分及无分数reviewAssignments；名单以assessments.participants快照与rosterRevision为准；POST统一业务命令。大数据先select。",
  },
  {
    path: "/api/platform/{area}/state",
    methods: ["GET"],
    description:
      "area=workspace/homework/exams/questions/learning/admin；scope=reviewing用于阅卷范围，仅exams/homework可附requestedSubmissionId显式读取当前授权的单份退回/替换答卷，独立requestedReview只读且不进队列/分析；双评隔离及reviewAssignments与完整状态一致。",
  },
  {
    path: "/api/platform/{area}/commands",
    methods: ["POST"],
    description:
      "area=questions/papers/classrooms/assessments/templates/submissions/reviews；统一业务命令。",
  },
  {
    path: "/api/platform/questions",
    methods: ["GET"],
    description:
      "分页检索题库。query: id 或 stats=1；或 page, subject, grade, type, q, searchMode=keyword/semantic。",
  },
  {
    path: "/api/platform/analytics",
    methods: ["GET"],
    description:
      "授权范围内成绩、知识点、错题；盲评题不计入得分及学习聚合。query: assessmentId,classroomId,studentId,kind=EXAM/HOMEWORK。",
  },
  {
    path: "/api/platform/ai",
    methods: ["GET", "POST"],
    description:
      "GET 本人的 jobs 和可用 models；POST 创建自主 AI 任务，立即返回 id，并不意味着完成。",
  },
  {
    path: "/api/platform/ai/{id}",
    methods: ["GET"],
    description: "读取本人 AI 任务的状态、结果与错误。",
  },
  {
    path: "/api/platform/ai/{id}/retry",
    methods: ["POST"],
    description: "重试本人失败的 AI 任务。",
  },
  {
    path: "/api/platform/admin",
    methods: ["GET", "POST"],
    description: "管理员读取模型/检索配置，执行账号、角色、教学权限、模型供应商和向量索引命令。",
  },
  {
    path: "/api/platform/admin/permissions/{id}/history",
    methods: ["GET"],
    description:
      "仅当前ADMIN按目标账号读取不可变角色/教学权限变更历史，query beforeId/limit，按createdAt与id降序；历史不含账号密码，不授予修改能力。",
  },
  {
    path: "/api/platform/users",
    methods: ["GET"],
    description:
      "按需搜索账号目录：query为姓名/登录账号/邮箱关键词（大小写不敏感），role=ADMIN/TEACHER/STUDENT筛选，或id精确读取单账号。学生403；教师仅教职员与可见班级学生，管理员全校；最多返回200条并附total。给student.save绑定已有账号先用role=STUDENT加关键词找人；完整state的users只含教职员。",
  },
  {
    path: "/api/platform/templates",
    methods: ["POST"],
    description: "按试卷生成并保存答题卡模板。body: {paperId,presetId?}。",
  },
  {
    path: "/api/platform/revision-papers",
    methods: ["POST"],
    description: "保存错题原题重做题本。",
  },
  {
    path: "/api/platform/print",
    methods: ["GET"],
    description:
      "Word: paperId,format=docx；答题卡: templateId,format=svg,page；返回下载链接。PDF 请打开题本导出页打印。",
  },
  {
    path: "/api/platform/barcodes",
    methods: ["GET"],
    description: "生成班级考号条码标签。query: classroomId,copies=1..20；返回 pages。",
  },
  {
    path: "/api/platform/accounts/import",
    methods: ["GET", "POST", "PUT"],
    description:
      "GET 下载导入模板 query role=STUDENT/TEACHER,format=csv/xlsx,classroomId?；POST bodyText 为 CSV，query extension=csv,role,classroomId；PUT 提交结构化账号。POST query download=credentials 下载账号表。",
  },
  {
    path: "/api/platform/materials",
    methods: ["POST"],
    description:
      "multipart 上传图片或 PDF 为分页资产；界面附件自动执行此能力。fields: maxPages；files: file。",
  },
  {
    path: "/api/platform/assets",
    methods: ["POST"],
    description: "multipart 保存图片，files: file。已有附件可直接复用。",
  },
  {
    path: "/api/platform/assets/{id}",
    methods: ["GET"],
    description: "读取授权图片。查看内容请使用 view_image 工具。",
  },
  {
    path: "/api/platform/scan",
    methods: ["POST"],
    description:
      "multipart 扫描录入。fields: assessmentId,paperId,rosterRevision（当前已确认名单版本）,kind=CARD/WORKBOOK,templateId?,studentId?,boxes?（JSON）,sources（JSON 数组 {assetUrl}）；也可 files: files。",
  },
] as const;
export const progressEndpoints = [
  "/api/platform/ai/events",
  "/api/platform/ai/{id}/events",
  "/api/platform/admin/ai-progress",
];

/** An exact, canonical route allowlist: credentials can never follow an arbitrary URL. */
export function resolveWebsitePath(path: string, method: string) {
  if (
    progressEndpoints.some((pattern) =>
      new RegExp(`^${pattern.replace("{id}", "[a-zA-Z0-9_-]+")}$`).test(path),
    )
  )
    throw new RequestError(400, "实时事件接口由聊天界面订阅；查询任务请使用任务详情接口。");
  if (!/^\/api\/platform(?:\/[a-zA-Z0-9_-]+)*$/.test(path))
    throw new RequestError(400, "只能调用目录内的站内 API；参数请放在 query 中。");
  const entry = apiCatalog.find((entry) => {
    const pattern = entry.path.replace(/\{(?:id|area)\}/g, "[a-zA-Z0-9_-]+");
    return (
      new RegExp(`^${pattern}$`).test(path) && (entry.methods as readonly string[]).includes(method)
    );
  });
  if (!entry) throw new RequestError(400, "接口或请求方法不在网站功能目录中。");
  if (
    path.endsWith("/state") &&
    path !== "/api/platform/school/state" &&
    !/^\/api\/platform\/(workspace|homework|exams|questions|learning|admin)\/state$/.test(path)
  )
    throw new RequestError(400, "未知页面模块。");
  if (
    path.endsWith("/commands") &&
    path !== "/api/platform/school/commands" &&
    path !== "/api/platform/teaching/commands" &&
    path !== "/api/platform/homework/commands" &&
    path !== "/api/platform/practice/commands" &&
    !/^\/api\/platform\/(questions|papers|classrooms|assessments|templates|submissions|reviews)\/commands$/.test(
      path,
    )
  )
    throw new RequestError(400, "未知命令模块。");
  return entry;
}

export function describeApi(name: string) {
  // Describe individual operations rather than injecting the entire platform schema into every turn.
  const schoolCommand = schoolCommandSchema.options.find(
    (option) => option.shape.type.value === name,
  );
  const teachingCommand = teachingCommandSchema.options.find(
    (option) => option.shape.type.value === name,
  );
  const homeworkCommand = homeworkCommandSchema.options.find(
    (option) => option.shape.type.value === name,
  );
  const practiceCommand = practiceCommandSchema.options.find(
    (option) => option.shape.type.value === name,
  );
  const command = commandSchema.options.find((option) => option.shape.type.value === name);
  const admin = adminCommandSchema.options.find((option) => option.shape.type.value === name);
  const ai = aiRequestSchema.options.find((option) => option.shape.kind.value === name);
  const special: Record<string, z.ZodType> = {
    "revision-papers": replayPaperSchema,
    "accounts.import": accountImportSchema,
    "accounts.credentials": importResultSchema,
  };
  const schema =
    command ??
    schoolCommand ??
    teachingCommand ??
    homeworkCommand ??
    practiceCommand ??
    admin ??
    ai ??
    special[name];
  if (schema) return z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  if (name === "operations")
    return {
      commands: commandSchema.options.map((option) => option.shape.type.value),
      schoolCommands: schoolCommandSchema.options.map((option) => option.shape.type.value),
      teachingCommands: teachingCommandSchema.options.map((option) => option.shape.type.value),
      homeworkCommands: homeworkCommandSchema.options.map((option) => option.shape.type.value),
      practiceCommands: practiceCommandSchema.options.map((option) => option.shape.type.value),
      admin: adminCommandSchema.options.map((option) => option.shape.type.value),
      aiTasks: aiRequestSchema.options.map((option) => option.shape.kind.value),
      other: Object.keys(special),
    };
  throw new RequestError(400, "参数说明不存在。先读取 operations 获取可用操作名。");
}

export function projectWebsiteData(data: unknown, select?: string, offset = 0, limit = 30) {
  let selected = data;
  if (select)
    for (const key of select.split(".")) {
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        !selected ||
        typeof selected !== "object" ||
        !Object.hasOwn(selected, key)
      )
        throw new RequestError(400, `响应中没有字段 ${select}。`);
      selected = (selected as Record<string, unknown>)[key];
    }
  const total = Array.isArray(selected) ? selected.length : undefined;
  if (Array.isArray(selected)) selected = selected.slice(offset, offset + limit);
  const serialized = JSON.stringify(selected);
  return serialized.length > 60000
    ? {
        truncated: true,
        preview: serialized.slice(0, 60000),
        total,
        hint: "使用 select 指定更深字段，或减小 limit；未返回的数据不能视为不存在。",
      }
    : { data: selected, total, offset, hasMore: total !== undefined && offset + limit < total };
}
