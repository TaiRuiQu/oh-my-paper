"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { SchoolState } from "@/contracts/school";
import { PageHeader } from "@/components/platform/page-header";
import { Empty, Field } from "@/components/platform/primitives";
import { SchoolPanel as Panel } from "./school-panel";
import { SchoolProvider, useSchool } from "./school-provider";
import { SchoolSettings } from "./school-settings";
import { SchoolScheduleView, schoolToday } from "./schedule";
import { TimetableEditor, type TimetableLeaveGuard } from "./timetable";
import styles from "./school.module.css";

export type SchoolSection = "overview" | "settings" | "timetable" | "schedule";
export function SchoolWorkspace({
  initialState,
  section,
}: {
  initialState: SchoolState;
  section: SchoolSection;
}) {
  return (
    <SchoolProvider initialState={initialState}>
      <Workspace section={section} />
    </SchoolProvider>
  );
}
function Workspace({ section }: { section: SchoolSection }) {
  const { state, pending, stale } = useSchool();
  const leaveGuard = useRef<TimetableLeaveGuard>(null);
  const [termId, setTermId] = useState(
    () =>
      state.terms.find((term) => {
        const today = schoolToday(term.timezone);
        return !term.archived && term.startDate <= today && term.endDate >= today;
      })?.id ??
      state.terms.find((term) => !term.archived)?.id ??
      state.terms[0]?.id ??
      "",
  );
  const term = state.terms.find((entry) => entry.id === termId);
  const title = {
    overview: "教学安排",
    settings: "教务设置",
    timetable: "学期排课",
    schedule: "我的课表",
  }[section];
  return (
    <div className={styles.workspace}>
      <PageHeader
        title={title}
        description={
          state.canManage
            ? "维护学期教学安排，检查并发布师生课表。"
            : "按学校时区查看本人可以访问的已发布课程。"
        }
      />
      <nav className={styles.navigation} aria-label="教学安排导航">
        <Link href="/school" aria-current={section === "overview" ? "page" : undefined}>
          教学安排
        </Link>
        <Link href="/school/schedule" aria-current={section === "schedule" ? "page" : undefined}>
          我的课表
        </Link>
        {state.actor.role !== "STUDENT" && <Link href="/school/teaching">备课与课堂</Link>}
        {state.canManage && (
          <>
            <Link
              href="/school/settings"
              aria-current={section === "settings" ? "page" : undefined}
            >
              教务设置
            </Link>
            <Link
              href="/school/timetable"
              aria-current={section === "timetable" ? "page" : undefined}
            >
              学期排课
            </Link>
          </>
        )}
      </nav>
      {section === "settings" ? (
        <SchoolSettings />
      ) : section === "timetable" && !state.canManage ? (
        <Panel title="排课管理">
          <Empty>当前账号没有排课管理权限，请在我的课表查看已发布课程。</Empty>
        </Panel>
      ) : (
        <>
          <Field label="查看学期">
            <select
              value={termId}
              disabled={pending || stale}
              onChange={(event) => {
                if (
                  section === "timetable" &&
                  leaveGuard.current &&
                  !leaveGuard.current.confirmLeave()
                )
                  return;
                setTermId(event.target.value);
              }}
            >
              <option value="">选择学期</option>
              {state.terms.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {entry.archived ? "（已归档）" : ""}
                </option>
              ))}
            </select>
          </Field>
          {!term ? (
            <Panel title="学期课程">
              <Empty>
                {state.canManage
                  ? "尚未选择学期。请先在教务设置创建学年与学期。"
                  : "暂无可查看的学期，请联系学校教务管理人员。"}
              </Empty>
              {state.canManage && (
                <Link className="button" href="/school/settings">
                  设置学年与学期
                </Link>
              )}
            </Panel>
          ) : section === "timetable" ? (
            <TimetableEditor key={term.id} term={term} leaveGuard={leaveGuard} />
          ) : (
            <>
              {section === "overview" && state.canManage && (
                <Panel
                  title="本学期安排"
                  description="按顺序完成基础设置、排课检查与发布，再从课表查看师生实际课程。"
                >
                  <p>
                    {term.name} · {term.startDate} 至 {term.endDate} · {term.timezone}
                  </p>
                  <p>
                    草稿版本 v{term.revision} · 已发布{" "}
                    {term.publishedRevision === null ? "无" : `v${term.publishedRevision}`}
                    {term.publishedRevision !== null && term.publishedRevision !== term.revision
                      ? " · 有未发布修改"
                      : ""}
                  </p>
                  <ol className={styles.steps}>
                    <li>
                      <Link href="/school/settings">设置课程、教室与开课任务</Link>
                    </li>
                    <li>
                      <Link href="/school/timetable">编排节次、校历与调代课，检查后发布</Link>
                    </li>
                    <li>
                      <Link href="/school/schedule">查看已发布课程</Link>
                    </li>
                  </ol>
                </Panel>
              )}
              <SchoolScheduleView key={term.id} term={term} />
            </>
          )}
        </>
      )}
    </div>
  );
}
