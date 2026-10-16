import "server-only";
import type { Actor } from "@/contracts/platform";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import {
  teachingCommandSchema,
  teachingHistoryQuerySchema,
  teachingListQuerySchema,
  teachingPlanSchema,
  lessonPrepareInputSchema,
  type TeachingCommandResult,
  type TeachingHistory,
  type TeachingSessions,
  type TeachingSession,
} from "@/contracts/teaching";
import { assertAssets, json, missing, type Db } from "../access";
import { canManageSchool } from "../school/service";
import { questionAssetUrls } from "@/lib/question-assets";
import { teachingPlanAssets } from "@/lib/teaching-assets";
import { schoolDateRange } from "@/lib/school-calendar";
import {
  conflict,
  currentBinding,
  planDTO,
  rosterPreview,
  sessionAccess,
  sessionDTO,
  sameClassroomCourse,
  teachingActor,
} from "./context";

export async function loadTeachingSession(actor: Actor, id: string, db: Db = getDb()) {
  const current = await teachingActor(actor, db);
  return sessionDTO(await sessionAccess(db, current, id));
}
export async function loadTeachingSessions(
  actor: Actor,
  input: unknown,
  db: Db = getDb(),
): Promise<TeachingSessions> {
  const current = await teachingActor(actor, db);
  const parsed = teachingListQuerySchema.safeParse(input);
  if (!parsed.success) throw new RequestError(400, "课堂查询参数无效。");
  const query = parsed.data;
  if (
    (query.startDate || query.endDate) &&
    (!query.startDate || !query.endDate || !schoolDateRange(query.startDate, query.endDate))
  )
    throw new RequestError(400, "请同时提供有效起止日期，且不超过400天。");
  // Query persisted sessions without exposing rows from another teacher. Newly published
  // substitute teachers also find sessions through the current immutable lesson links.
  const terms = await db.schoolTerm.findMany({
    where: { ...(query.termId ? { id: query.termId } : {}), publishedRevision: { not: null } },
  });
  const publications = await db.schoolPublication.findMany({
    where: { OR: terms.map((term) => ({ termId: term.id, revision: term.publishedRevision! })) },
    include: {
      lessons: {
        where: {
          ...(!canManageSchool(current) ? { teacherId: current.id } : {}),
          ...(query.startDate ? { date: { gte: query.startDate, lte: query.endDate } } : {}),
        },
      },
    },
  });
  const assignedKeys = publications.flatMap((publication) =>
    publication.lessons
      .filter((lesson) => lesson.teacherId === current.id)
      .map((lesson) => {
        const snapshot = lesson.snapshot as unknown as { slotId: string; originalDate: string };
        return {
          termId: publication.termId,
          slotId: snapshot.slotId,
          originalDate: snapshot.originalDate,
        };
      }),
  );
  const manage = canManageSchool(current);
  const scope: Prisma.TeachingSessionWhereInput = {
    ...(query.termId ? { termId: query.termId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.startDate
      ? {
          AND: [
            {
              OR: [
                {
                  lessons: {
                    some: { lesson: { date: { gte: query.startDate, lte: query.endDate } } },
                  },
                },
                ...publications.flatMap((publication) =>
                  publication.lessons
                    .filter(
                      (lesson) => lesson.date >= query.startDate! && lesson.date <= query.endDate!,
                    )
                    .map((lesson) => {
                      const snapshot = lesson.snapshot as unknown as {
                        slotId: string;
                        originalDate: string;
                      };
                      return {
                        termId: publication.termId,
                        slotId: snapshot.slotId,
                        originalDate: snapshot.originalDate,
                      };
                    }),
                ),
              ],
            },
          ],
        }
      : {}),
    ...(!manage ? { OR: [{ teacherId: current.id }, ...assignedKeys] } : {}),
  };
  const matchesDates = (detail: TeachingSession) => {
    const effective =
      detail.status === "NOT_STARTED" && detail.currentSchedule
        ? detail.currentSchedule
        : detail.binding;
    return (
      !query.startDate ||
      effective.lessons.some(
        (lesson) => lesson.date >= query.startDate! && lesson.date <= query.endDate!,
      )
    );
  };
  let cursor: { id: string; createdAt: Date } | null = null;
  if (query.beforeId) {
    cursor = await db.teachingSession.findFirst({
      where: { AND: [scope, { id: query.beforeId }] },
      select: { id: true, createdAt: true },
    });
    if (!cursor) throw missing();
    const detail = sessionDTO(await sessionAccess(db, current, cursor.id));
    if (!matchesDates(detail)) throw missing();
  }
  const sessions: TeachingSessions["sessions"] = [];
  const take = query.limit + 1;
  // Current publication and historical teaching identities are finally checked by
  // sessionAccess. Scan past rejected candidates so they cannot shorten a page
  // or hide accessible records beyond it. Only fetch metadata before that check.
  while (sessions.length <= query.limit) {
    const rows: { id: string; createdAt: Date }[] = await db.teachingSession.findMany({
      where: {
        AND: [
          scope,
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: { id: true, createdAt: true },
    });
    for (const row of rows) {
      try {
        const detail = sessionDTO(await sessionAccess(db, current, row.id));
        if (matchesDates(detail)) sessions.push(detail);
      } catch (cause) {
        if (!(cause instanceof AccessError && cause.status === 404)) throw cause;
      }
      if (sessions.length > query.limit) break;
    }
    if (rows.length < take || sessions.length > query.limit) break;
    cursor = rows[rows.length - 1];
  }
  return {
    actor: current,
    canManage: manage,
    sessions: sessions.slice(0, query.limit),
    nextBeforeId: sessions.length > query.limit ? sessions[query.limit - 1].id : null,
  };
}
export async function previewTeachingRoster(actor: Actor, id: string, db: Db = getDb()) {
  const current = await teachingActor(actor, db);
  const access = await sessionAccess(db, current, id);
  if (!sessionDTO(access).canManageRoster)
    throw new AccessError(403, "仅当前授课者或管理者可核对课堂名单。");
  return rosterPreview(db, access.row);
}
export async function loadTeachingHistory(
  actor: Actor,
  id: string,
  input: unknown = {},
  db: Db = getDb(),
): Promise<TeachingHistory> {
  const current = await teachingActor(actor, db);
  await sessionAccess(db, current, id);
  const parsed = teachingHistoryQuerySchema.safeParse(input);
  if (!parsed.success) throw new RequestError(400, "课堂历史参数无效。");
  const query = parsed.data;
  const rows = await db.teachingEvent.findMany({
    where: {
      sessionId: id,
      ...(query.beforeVersion ? { version: { lt: query.beforeVersion } } : {}),
    },
    orderBy: { version: "desc" },
    take: query.limit + 1,
  });
  const planIds = [
    ...new Set(
      rows.slice(0, query.limit).flatMap((event) => {
        const snapshot = event.snapshot as unknown as { plan?: { id?: string } | null };
        return snapshot.plan?.id ? [snapshot.plan.id] : [];
      }),
    ),
  ];
  const plans = await db.teachingPlanVersion.findMany({
    where: { sessionId: id, id: { in: planIds } },
    orderBy: { version: "desc" },
  });
  return {
    sessionId: id,
    events: rows.slice(0, query.limit).map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      snapshot: row.snapshot as unknown as TeachingHistory["events"][number]["snapshot"],
    })),
    plans: plans.map(planDTO),
    nextBeforeVersion: rows.length > query.limit ? rows[query.limit - 1].version : null,
  };
}

export async function executeTeachingCommand(
  actor: Actor,
  input: unknown,
  context: { db?: Prisma.TransactionClient; source?: "HUMAN" | "AI"; jobId?: string } = {},
): Promise<TeachingCommandResult> {
  const parsed = teachingCommandSchema.safeParse(input);
  if (!parsed.success)
    throw new RequestError(400, parsed.error.issues.map((issue) => issue.message).join("；"));
  const command = parsed.data;
  const execute = async (db: Prisma.TransactionClient): Promise<TeachingCommandResult> => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
    const current = await teachingActor(actor, db);
    if (context.source === "AI" && command.type !== "teaching.plan.save")
      throw new AccessError(403, "AI只能保存候选教案，不能确认或开始课堂。");
    async function audit(id: string, version: number, reason: string) {
      const snapshot = await loadTeachingSession(current, id, db);
      // Capability flags are reader-specific and are recomputed by detail queries.
      await db.teachingEvent.create({
        data: {
          sessionId: id,
          version,
          type: command.type,
          actorId: current.id,
          actorName: current.name,
          reason,
          snapshot: json(snapshot),
        },
      });
    }
    if (command.type === "teaching.session.prepare") {
      const binding = await currentBinding(
        db,
        command.termId,
        command.slotId,
        command.originalDate,
      );
      if (!binding || binding.publicationId !== command.publicationId)
        throw conflict("课次已取消或发布版本已变化，请重新读取课表。");
      if (!canManageSchool(current) && binding.lessons[0].teacherId !== current.id) throw missing();
      const term = await db.schoolTerm.findUnique({ where: { id: command.termId } });
      if (term?.archived) throw conflict("归档学期不能新建课堂。");
      const existing = await db.teachingSession.findUnique({
        where: {
          termId_slotId_originalDate: {
            termId: command.termId,
            slotId: command.slotId,
            originalDate: command.originalDate,
          },
        },
      });
      if (existing) {
        if (
          !sameClassroomCourse(
            existing.binding as unknown as import("@/contracts/teaching").TeachingBinding,
            binding,
          )
        )
          throw conflict("本课表编号已保存其他班级或课程的课堂，请在课表中新建编号后准备。");
        await sessionAccess(db, current, existing.id);
        return { id: existing.id, version: existing.version };
      }
      const row = await db.teachingSession.create({
        data: {
          termId: command.termId,
          slotId: command.slotId,
          originalDate: command.originalDate,
          teacherId: binding.lessons[0].teacherId,
          binding: json(binding),
        },
      });
      await db.teachingSessionLesson.createMany({
        data: binding.lessonIds.map((lessonId) => ({
          sessionId: row.id,
          bindingVersion: 1,
          lessonId,
        })),
      });
      await audit(row.id, row.version, "根据已发布课次准备课堂，连堂共用一份记录。");
      return { id: row.id, version: row.version };
    }
    const access = await sessionAccess(db, current, command.sessionId);
    const { row, binding, latest, manager } = access;
    if (row.version !== command.expectedVersion) throw conflict();
    const dto = sessionDTO(access);
    const term = await db.schoolTerm.findUnique({ where: { id: row.termId } });
    if (row.status === "NOT_STARTED" && term?.archived)
      throw conflict("归档学期不能修改或开始新课堂。");
    const beforeStart = row.status === "NOT_STARTED";
    const teacher = row.teacherId === current.id;
    const writable =
      manager || (beforeStart ? access.assigned && teacher : row.startedAt !== null && teacher);
    if (!writable && command.type !== "teaching.session.rebind")
      throw new AccessError(403, "当前账号只有课堂历史查看权限。");
    const update: Prisma.TeachingSessionUpdateInput = {};
    let auditReason = "";
    let nextPlanVersion: number | undefined;
    switch (command.type) {
      case "teaching.session.rebind": {
        if (!beforeStart || !latest || latest.publicationId !== command.publicationId)
          throw conflict("只有未开始课堂可明确绑定当前已发布课次。");
        if (!sameClassroomCourse(binding, latest))
          throw conflict("原课堂不能改绑到另一班级或课程，请以新课表编号建立课堂。");
        if (!manager && !access.assigned) throw missing();
        update.binding = json(latest);
        update.bindingVersion = row.bindingVersion + 1;
        update.teacher = { connect: { id: latest.lessons[0].teacherId } };
        update.confirmedPlanVersion = null;
        update.rosterConfirmed = false;
        await db.teachingSessionLesson.createMany({
          data: latest.lessonIds.map((lessonId) => ({
            sessionId: row.id,
            bindingVersion: row.bindingVersion + 1,
            lessonId,
          })),
        });
        auditReason = command.reason;
        break;
      }
      case "teaching.plan.save": {
        if (
          !dto.canPrepare ||
          command.expectedBindingVersion !== row.bindingVersion ||
          command.expectedPlanVersion !== row.planVersion
        )
          throw conflict("教案、课次绑定或课堂状态已变化，请重新核对。");
        if (context.source === "AI") {
          const job = context.jobId
            ? await db.aiJob.findUnique({ where: { id: context.jobId } })
            : null;
          const baseline = lessonPrepareInputSchema.safeParse(job?.input);
          if (
            !job ||
            job.userId !== current.id ||
            job.kind !== "LESSON_PREPARE" ||
            job.status !== "RUNNING" ||
            !baseline.success ||
            baseline.data.sessionId !== row.id ||
            baseline.data.publicationId !== binding.publicationId ||
            baseline.data.expectedVersion !== row.version ||
            baseline.data.expectedPlanVersion !== row.planVersion ||
            baseline.data.expectedBindingVersion !== row.bindingVersion
          )
            throw conflict("AI候选教案的来源任务或课堂基线已失效。");
        }
        const plan = teachingPlanSchema.parse(command.plan);
        const previousMaterials = row.plans[0]
          ? teachingPlanSchema.parse(row.plans[0].plan).materials
          : [];
        const retained = new Set<string>();
        const materialKey = (material: (typeof plan.materials)[number]) =>
          JSON.stringify({
            kind: material.kind,
            content: material.content,
            url: material.url,
            questionId: material.questionId,
          });
        for (const material of plan.materials) {
          const preserved =
            material.kind !== "TEXT" &&
            previousMaterials.some((previous) => materialKey(previous) === materialKey(material));
          if (preserved) {
            retained.add(materialKey(material));
            continue;
          }
          if (
            (material.kind !== "ASSET" && material.url) ||
            (material.kind !== "QUESTION" && material.questionId)
          )
            throw new RequestError(400, "材料类型与引用来源不一致。");
          if (material.questionId) {
            const question = await db.question.findUnique({ where: { id: material.questionId } });
            if (!question || (current.role !== "ADMIN" && question.ownerId !== current.id))
              throw missing();
            material.content = JSON.stringify({
              source: "QUESTION_SNAPSHOT",
              questionId: question.id,
              updatedAt: question.updatedAt.toISOString(),
              type: question.type,
              subject: question.subject,
              grade: question.grade,
              content: question.content,
            });
            if (material.content.length > 20000)
              throw new RequestError(400, "题目材料快照超过20000字，请选择较短材料或拆分教案。");
            // The authoritative question's attached refs were already validated when saved.
            // Permit those sources without letting other plan text borrow their authority.
            const sourceContent = question.content as { images?: unknown };
            const attached = Array.isArray(sourceContent.images) ? sourceContent.images : [];
            for (const url of questionAssetUrls(question.content)) {
              const asset = await db.platformAsset.findUnique({
                where: { id: url.split("/").at(-1)! },
              });
              if (
                !asset ||
                (current.role !== "ADMIN" &&
                  asset.ownerId !== current.id &&
                  !attached.includes(url))
              )
                throw missing();
            }
          }
        }
        const urls = new Set<string>();
        const collectText = (text: string) =>
          questionAssetUrls({ stem: text }).forEach((url) => urls.add(url));
        for (const value of Object.values(plan)) if (typeof value === "string") collectText(value);
        for (const activity of plan.activities)
          for (const value of Object.values(activity))
            if (typeof value === "string") collectText(value);
        for (const material of plan.materials) {
          if (retained.has(materialKey(material))) continue;
          if (material.kind !== "QUESTION") collectText(material.content);
          if (material.url) urls.add(material.url);
        }
        await assertAssets(db, current, [...urls]);
        nextPlanVersion = row.planVersion + 1;
        await db.teachingPlanVersion.create({
          data: {
            sessionId: row.id,
            version: nextPlanVersion,
            bindingVersion: row.bindingVersion,
            source: context.source ?? "HUMAN",
            aiJobId: context.source === "AI" ? context.jobId : null,
            actorId: current.id,
            actorName: current.name,
            plan: json(plan),
            assetUrls: teachingPlanAssets(plan),
          },
        });
        update.planVersion = nextPlanVersion;
        update.confirmedPlanVersion = null;
        auditReason =
          context.source === "AI" ? "AI候选教案已保存，须教师核对确认。" : "保存人工教案草稿。";
        break;
      }
      case "teaching.plan.confirm":
        if (
          !dto.canPrepare ||
          row.planVersion === 0 ||
          command.planVersion !== row.planVersion ||
          row.plans[0]?.bindingVersion !== row.bindingVersion
        )
          throw conflict("请确认当前课次绑定下的最新教案。");
        update.confirmedPlanVersion = row.planVersion;
        auditReason = "教师明确确认当前教案。";
        break;
      case "teaching.roster.confirm": {
        if (!dto.canPrepare || row.rosterConfirmed || row.participants.length)
          throw conflict("已有课堂快照须明确增补或退出成员，不能重新生成。");
        const preview = await rosterPreview(db, row);
        if (preview.fingerprint !== command.fingerprint)
          throw conflict("班级名册已变化，请重新预览并核对。");
        if (!preview.candidates.length) throw new RequestError(400, "课堂名单不能为空。");
        await db.teachingParticipant.createMany({
          data: preview.candidates.map((student) => ({ ...student, sessionId: row.id })),
        });
        update.rosterConfirmed = true;
        update.rosterFingerprint = preview.fingerprint;
        auditReason = "核对班级名单指纹后确认本次课堂快照。";
        break;
      }
      case "teaching.roster.update": {
        if (
          !dto.canManageRoster ||
          !row.participants.length ||
          (!row.rosterConfirmed && row.bindingVersion === 1)
        )
          throw conflict("请先确认课堂名单后再明确调整。");
        const preview = await rosterPreview(db, row);
        if (preview.fingerprint !== command.fingerprint)
          throw conflict("班级名册已变化，请重新预览并核对。");
        if (
          ![
            command.addStudentIds,
            command.excludeParticipantIds,
            command.restoreParticipantIds,
          ].every((ids) => new Set(ids).size === ids.length) ||
          command.excludeParticipantIds.some((id) => command.restoreParticipantIds.includes(id))
        )
          throw new RequestError(400, "名单调整不能重复或互相冲突。");
        for (const id of command.addStudentIds) {
          const student = preview.candidates.find((candidate) => candidate.studentId === id);
          if (!student || row.participants.some((participant) => participant.studentId === id))
            throw new RequestError(400, "新增学生必须来自当前班级且尚未在课堂名单内。");
          await db.teachingParticipant.create({
            data: { ...student, sessionId: row.id, rosterReason: command.reason },
          });
        }
        for (const [ids, status] of [
          [command.excludeParticipantIds, "EXCLUDED"],
          [command.restoreParticipantIds, "EXPECTED"],
        ] as const)
          for (const id of ids) {
            const participant = row.participants.find((entry) => entry.id === id);
            if (
              !participant ||
              (status === "EXPECTED" &&
                !preview.candidates.some(
                  (candidate) => candidate.studentId === participant.studentId,
                ))
            )
              throw new RequestError(400, "名单成员不存在或已不属于本班。");
            await db.teachingParticipant.update({
              where: { id },
              data: { rosterStatus: status, rosterReason: command.reason },
            });
          }
        update.rosterConfirmed = true;
        update.rosterFingerprint = preview.fingerprint;
        auditReason = command.reason;
        break;
      }
      case "teaching.attendance.save":
        if (!dto.canTakeAttendance || !row.rosterConfirmed)
          throw conflict("课堂当前不可登记出勤。");
        await marks(command.marks);
        auditReason = "保存逐人出勤登记。";
        break;
      case "teaching.session.start": {
        if (!dto.canStart) throw conflict("开课须确认当前教案、课堂名单及已发布课次绑定。");
        if (!row.participants.some((participant) => participant.rosterStatus === "EXPECTED"))
          throw conflict("至少保留一位本次应到学生后才能开课。");
        const preview = await rosterPreview(db, row);
        if (preview.fingerprint !== row.rosterFingerprint)
          throw conflict("班级名单在确认后已变化，请预览差异并明确调整课堂名单。");
        update.status = "IN_PROGRESS";
        update.startedAt = new Date();
        auditReason = "开始授课，锁定本次课次与名单快照。";
        break;
      }
      case "teaching.session.finish":
        if (!dto.canFinish) throw conflict("仅进行中或已中断课堂可结束。");
        if (
          row.participants.some(
            (participant) =>
              participant.rosterStatus === "EXPECTED" && participant.attendance === "UNMARKED",
          )
        )
          throw conflict("仍有应到学生未登记出勤，请逐人核对后结束。");
        update.status = "COMPLETED";
        update.finishedAt = new Date();
        update.summary = command.summary;
        update.reflection = command.reflection;
        auditReason = "结束课堂并保存授课总结与反思。";
        break;
      case "teaching.session.interrupt":
        if (row.status !== "IN_PROGRESS") throw conflict("仅授课中课堂可中断。");
        update.status = "INTERRUPTED";
        update.interruptedAt = new Date();
        auditReason = command.reason;
        break;
      case "teaching.session.resume":
        if (row.status !== "INTERRUPTED") throw conflict("仅中断课堂可继续。");
        update.status = "IN_PROGRESS";
        auditReason = command.reason;
        break;
      case "teaching.session.cancel":
        if (!beforeStart) throw conflict("已开始课堂请登记中断或结束，不能取消历史。");
        update.status = "CANCELLED";
        auditReason = command.reason;
        break;
      case "teaching.session.correct":
        if (!dto.canCorrect) throw conflict("仅已完成课堂可作有原因更正。");
        if (
          !command.marks.length &&
          command.summary === undefined &&
          command.reflection === undefined
        )
          throw new RequestError(400, "请选择需要更正的记录。");
        await marks(command.marks, true);
        if (command.summary !== undefined) update.summary = command.summary;
        if (command.reflection !== undefined) update.reflection = command.reflection;
        auditReason = command.reason;
        break;
    }
    async function marks(
      entries: { participantId: string; status: string; reason: string }[],
      correcting = false,
    ) {
      if (new Set(entries.map((entry) => entry.participantId)).size !== entries.length)
        throw new RequestError(400, "不能重复登记同一学生。");
      for (const entry of entries) {
        if (
          !row.participants.some(
            (participant) =>
              participant.id === entry.participantId && participant.rosterStatus === "EXPECTED",
          )
        )
          throw new RequestError(400, "只能登记本次应到学生。");
        if (entry.status !== "UNMARKED" && entry.status !== "PRESENT" && !entry.reason.trim())
          throw new RequestError(400, "迟到、缺席、请假或早退须填写说明。");
        if (correcting && entry.status === "UNMARKED")
          throw new RequestError(400, "已完成课堂更正不能留下未登记出勤。");
        await db.teachingParticipant.update({
          where: { id: entry.participantId },
          data: { attendance: entry.status, attendanceReason: entry.reason },
        });
      }
    }
    const version = row.version + 1;
    await db.teachingSession.update({ where: { id: row.id }, data: { ...update, version } });
    await audit(row.id, version, auditReason);
    return { id: row.id, version, ...(nextPlanVersion ? { planVersion: nextPlanVersion } : {}) };
  };
  return context.db ? execute(context.db) : getDb().$transaction(execute, { timeout: 30000 });
}
