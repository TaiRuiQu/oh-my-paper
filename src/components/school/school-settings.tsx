"use client";

import { useEffect, useRef, useState } from "react";
import type {
  SchoolCourse,
  SchoolOffering,
  SchoolRoom,
  SchoolTerm,
  SchoolYear,
} from "@/contracts/school";
import { Empty, Field } from "@/components/platform/primitives";
import { SchoolPanel as Panel } from "./school-panel";
import { useSchool } from "./school-provider";
import { SchoolForm, textValue as value } from "./school-form";
import styles from "./school.module.css";

type Editor =
  | { kind: "year"; item?: SchoolYear }
  | { kind: "term"; item?: SchoolTerm }
  | { kind: "course"; item?: SchoolCourse }
  | { kind: "room"; item?: SchoolRoom }
  | { kind: "offering"; item?: SchoolOffering; term: SchoolTerm };
const labels = { year: "学年", term: "学期", course: "课程", room: "教室", offering: "开课任务" };

export function SchoolSettings() {
  const { state, pending, stale } = useSchool();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [termId, setTermId] = useState(
    state.terms.find((term) => !term.archived)?.id ?? state.terms[0]?.id ?? "",
  );
  const termTouched = useRef(false);
  useEffect(() => {
    if (termTouched.current || state.terms.some((item) => item.id === termId)) return;
    setTermId(state.terms.find((term) => !term.archived)?.id ?? state.terms[0]?.id ?? "");
  }, [state.terms, termId]);
  if (!state.canManage)
    return (
      <Panel title="教务设置">
        <Empty>当前账号可查看本人已发布课程。教务设置由学校教务管理人员维护。</Empty>
      </Panel>
    );
  const term = state.terms.find((item) => item.id === termId);
  const disabled = pending || stale || !!editor;
  const action = (
    kind: Exclude<Editor["kind"], "offering">,
    item?: SchoolYear | SchoolTerm | SchoolCourse | SchoolRoom,
  ) => (
    <button
      type="button"
      className="button secondary"
      disabled={disabled}
      onClick={() => setEditor({ kind, item } as Editor)}
    >
      {item ? `编辑${labels[kind]}：${item.name}` : `新建${labels[kind]}`}
    </button>
  );
  return (
    <div className={styles.stack}>
      <p className={styles.help}>
        先设置学年、学期和基础目录，再指定各班课程、任课教师与周课时。开课任务是排课依据；学生课表只展示已发布版本。
        课程或教室目录修改不会改写已发布课表；需要师生看到这些变更时，请重新保存排课草稿、检查并发布新版本。
      </p>
      {editor && <SettingsEditor editor={editor} close={() => setEditor(null)} />}
      <Panel
        title="学年与学期"
        actions={
          <>
            {action("year")}
            {action("term")}
          </>
        }
      >
        {!state.years.length && <Empty>尚未设置学年。先创建学年，再创建对应学期。</Empty>}
        <div className={styles.list}>
          {state.years.map((year) => (
            <div className={styles.row} key={year.id}>
              <div>
                <strong>{year.name}</strong>
                <p>
                  {year.startDate} 至 {year.endDate} · 版本 {year.version}
                </p>
              </div>
              {action("year", year)}
            </div>
          ))}
        </div>
        <div className={styles.list}>
          {state.terms.map((item) => (
            <div className={styles.row} key={item.id}>
              <div>
                <strong>
                  {item.name}
                  {item.archived ? "（已归档）" : ""}
                </strong>
                <p>
                  {state.years.find((year) => year.id === item.yearId)?.name} · {item.startDate} 至{" "}
                  {item.endDate} · {item.timezone}
                </p>
                <p>
                  第 1 周周一：{item.weekOneMonday} · 草稿版本 {item.revision} / 已发布{" "}
                  {item.publishedRevision ?? "无"}
                </p>
              </div>
              {action("term", item)}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="课程目录" actions={action("course")}>
        {!state.courses.length && <Empty>尚未创建课程。</Empty>}
        <div className={styles.list}>
          {state.courses.map((item) => (
            <div className={styles.row} key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.subject ?? "综合课程"} · {item.active ? "启用" : "已停用"}
                </p>
              </div>
              {action("course", item)}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="教室目录" actions={action("room")}>
        {!state.rooms.length && <Empty>尚未创建教室。排课也可暂不指定教室。</Empty>}
        <div className={styles.list}>
          {state.rooms.map((item) => (
            <div className={styles.row} key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.capacity === null ? "未设置容量" : `${item.capacity} 人`} ·{" "}
                  {item.active ? "启用" : "已停用"}
                </p>
              </div>
              {action("room", item)}
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="学期开课任务"
        description="每条任务指定一个班级、一门课程、一位教师与每周课时。停用任务不会静默改写已经发布的课表。"
      >
        <Field label="开课任务所属学期">
          <select
            value={termId}
            disabled={disabled}
            onChange={(event) => {
              termTouched.current = true;
              setTermId(event.target.value);
            }}
          >
            <option value="">选择学期</option>
            {state.terms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.archived ? "（已归档）" : ""}
              </option>
            ))}
          </select>
        </Field>
        <p>
          <button
            className="button"
            type="button"
            disabled={disabled || !term || term.archived}
            onClick={() => term && setEditor({ kind: "offering", term: { ...term } })}
          >
            新建开课任务
          </button>
        </p>
        {!term ? (
          <Empty>请选择或先创建学期。</Empty>
        ) : (
          <div className={styles.list}>
            {state.offerings
              .filter((item) => item.termId === term.id)
              .map((item) => (
                <div className={styles.row} key={item.id}>
                  <div>
                    <strong>
                      {
                        state.classrooms.find((classroom) => classroom.id === item.classroomId)
                          ?.name
                      }{" "}
                      · {state.courses.find((course) => course.id === item.courseId)?.name}
                    </strong>
                    <p>
                      {state.teachers.find((teacher) => teacher.id === item.teacherId)?.name} · 每周{" "}
                      {item.weeklyPeriods} 节 · {item.active ? "启用" : "已停用"}
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    disabled={disabled || term.archived}
                    onClick={() =>
                      setEditor({ kind: "offering", item: { ...item }, term: { ...term } })
                    }
                  >
                    编辑开课任务
                  </button>
                </div>
              ))}
            {!state.offerings.some((item) => item.termId === term.id) && (
              <Empty>本学期尚无开课任务。</Empty>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function SettingsEditor({ editor, close }: { editor: Editor; close: () => void }) {
  const { state } = useSchool();
  const title = `${editor.item ? "编辑" : "新建"}${labels[editor.kind]}`;
  if (editor.kind === "year")
    return (
      <SchoolForm
        title={title}
        close={close}
        command={(data) => ({
          type: "school.year.save",
          year: {
            id: editor.item?.id,
            expectedVersion: editor.item?.version,
            name: value(data, "name"),
            startDate: value(data, "startDate"),
            endDate: value(data, "endDate"),
          },
        })}
      >
        <div className="p-form-grid">
          <Field label="学年名称">
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={editor.item?.name}
              placeholder="例如：2026–2027 学年"
            />
          </Field>
          <Dates item={editor.item} />
        </div>
      </SchoolForm>
    );
  if (editor.kind === "term")
    return (
      <SchoolForm
        title={title}
        close={close}
        command={(data) => ({
          type: "school.term.save",
          term: {
            id: editor.item?.id,
            expectedRevision: editor.item?.revision,
            yearId: value(data, "yearId"),
            name: value(data, "name"),
            startDate: value(data, "startDate"),
            endDate: value(data, "endDate"),
            weekOneMonday: value(data, "weekOneMonday"),
            timezone: value(data, "timezone"),
            archived: data.has("archived"),
          },
        })}
      >
        <div className="p-form-grid">
          <Field label="所属学年">
            <select name="yearId" required defaultValue={editor.item?.yearId ?? ""}>
              <option value="">选择学年</option>
              {state.years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="学期名称">
            <input name="name" required maxLength={120} defaultValue={editor.item?.name} />
          </Field>
          <Dates item={editor.item} />
          <Field label="第 1 周的周一" hint="用于教学周及单双周计算，须选择星期一。">
            <input
              type="date"
              name="weekOneMonday"
              required
              defaultValue={editor.item?.weekOneMonday}
            />
          </Field>
          <Field label="学校时区" hint="课表日期与今天按此时区计算，如 Asia/Shanghai。">
            <input
              name="timezone"
              required
              list="school-timezones"
              defaultValue={editor.item?.timezone ?? "Asia/Shanghai"}
            />
            <datalist id="school-timezones">
              <option>Asia/Shanghai</option>
              <option>Asia/Hong_Kong</option>
              <option>Asia/Taipei</option>
              <option>America/Los_Angeles</option>
            </datalist>
          </Field>
        </div>
        <Field label="归档学期">
          <input type="checkbox" name="archived" defaultChecked={editor.item?.archived} />
        </Field>
      </SchoolForm>
    );
  if (editor.kind === "course")
    return (
      <SchoolForm
        title={title}
        close={close}
        command={(data) => ({
          type: "school.course.save",
          course: {
            id: editor.item?.id,
            expectedVersion: editor.item?.version,
            name: value(data, "name"),
            subject: value(data, "subject") || null,
            active: data.has("active"),
          },
        })}
      >
        <div className="p-form-grid">
          <Field label="课程名称">
            <input name="name" required maxLength={120} defaultValue={editor.item?.name} />
          </Field>
          <Field label="对应学科（选填）">
            <input name="subject" maxLength={40} defaultValue={editor.item?.subject ?? ""} />
          </Field>
        </div>
        <Field label="启用课程">
          <input type="checkbox" name="active" defaultChecked={editor.item?.active ?? true} />
        </Field>
      </SchoolForm>
    );
  if (editor.kind === "room")
    return (
      <SchoolForm
        title={title}
        close={close}
        command={(data) => ({
          type: "school.room.save",
          room: {
            id: editor.item?.id,
            expectedVersion: editor.item?.version,
            name: value(data, "name"),
            capacity: value(data, "capacity") ? Number(value(data, "capacity")) : null,
            active: data.has("active"),
          },
        })}
      >
        <div className="p-form-grid">
          <Field label="教室名称">
            <input name="name" required maxLength={120} defaultValue={editor.item?.name} />
          </Field>
          <Field label="容纳人数（选填）">
            <input
              name="capacity"
              type="number"
              min={1}
              max={10000}
              step={1}
              defaultValue={editor.item?.capacity ?? ""}
            />
          </Field>
        </div>
        <Field label="启用教室">
          <input type="checkbox" name="active" defaultChecked={editor.item?.active ?? true} />
        </Field>
      </SchoolForm>
    );
  const offering = editor.item;
  return (
    <SchoolForm
      title={title}
      close={close}
      command={(data) => ({
        type: "school.offering.save",
        termId: editor.term.id,
        expectedRevision: editor.term.revision,
        offering: {
          id: offering?.id,
          courseId: value(data, "courseId"),
          classroomId: value(data, "classroomId"),
          teacherId: value(data, "teacherId"),
          weeklyPeriods: Number(value(data, "weeklyPeriods")),
          active: data.has("active"),
        },
      })}
    >
      <p>
        {editor.term.name} · 基于草稿版本 {editor.term.revision}
      </p>
      <div className="p-form-grid">
        <Field label="开设课程">
          <select name="courseId" required defaultValue={offering?.courseId ?? ""}>
            <option value="">选择课程</option>
            {state.courses
              .filter((course) => course.active || course.id === offering?.courseId)
              .map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                  {course.active ? "" : "（已停用）"}
                </option>
              ))}
          </select>
        </Field>
        <Field label="授课班级">
          <select name="classroomId" required defaultValue={offering?.classroomId ?? ""}>
            <option value="">选择班级</option>
            {state.classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>
                {classroom.name} · {classroom.stage} {classroom.cohort}
              </option>
            ))}
          </select>
        </Field>
        <Field label="任课教师">
          <select name="teacherId" required defaultValue={offering?.teacherId ?? ""}>
            <option value="">选择教师</option>
            {state.teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="每周课时">
          <input
            name="weeklyPeriods"
            type="number"
            min={1}
            max={50}
            step={1}
            required
            defaultValue={offering?.weeklyPeriods ?? 1}
          />
        </Field>
      </div>
      <Field label="启用开课任务">
        <input type="checkbox" name="active" defaultChecked={offering?.active ?? true} />
      </Field>
    </SchoolForm>
  );
}

function Dates({ item }: { item?: { startDate: string; endDate: string } }) {
  return (
    <>
      <Field label="开始日期">
        <input type="date" name="startDate" required defaultValue={item?.startDate} />
      </Field>
      <Field label="结束日期">
        <input type="date" name="endDate" required defaultValue={item?.endDate} />
      </Field>
    </>
  );
}
