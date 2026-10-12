"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClassOverview } from "@/contracts/classes";
import { useClasses } from "./classes/use-classes";
import { StudentRoster } from "./classes/student-roster";
import { ClassBatchGrading } from "./classes/class-batch-grading";

export function Classes({
  initialClasses,
  grading = false,
}: {
  initialClasses: ClassOverview;
  grading?: boolean;
}) {
  const workspace = useClasses(initialClasses, grading);
  const { query, current, error, busy, create, setSelected, setBatch, setStudent, setDrafts } =
    workspace;
  return (
    <>
      <div className="workspace-heading">
        <h1>{grading ? "教师批量改卷" : "班级管理"}</h1>
        <p className="intro">
          {grading
            ? "选择已保存的题套，批量上传学生试卷或答题卡。"
            : "创建班级、维护学生名单，为批量改卷关联学生。"}
        </p>
      </div>
      {(error || query.error) && (
        <p className="form-error" role="alert">
          {error || "暂时无法更新班级，请刷新页面。"}
        </p>
      )}
      {!grading && (
        <details className="account-section" open={!query.data.classes.length}>
          <summary>新建班级</summary>
          <form onSubmit={(e) => void create(e, "/api/classes")}>
            <div className="field">
              <label htmlFor="class-name">班级名称</label>
              <Input
                id="class-name"
                name="name"
                required
                maxLength={80}
                placeholder="例如：七年级一班"
              />
            </div>
            <button className="button" disabled={busy}>
              创建班级
            </button>
          </form>
        </details>
      )}
      {grading && !query.data.classes.length && (
        <section className="empty-state">
          <h2>先创建一个班级</h2>
          <p>添加学生后，即可按题套创建批次并上传作答。</p>
          <Button asChild>
            <Link href="/classes">前往班级管理</Link>
          </Button>
        </section>
      )}
      {current && (
        <>
          <div className="learning-toolbar">
            <label>
              当前班级{" "}
              <select
                value={current.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setBatch("");
                  setStudent("");
                  setDrafts([]);
                }}
              >
                {query.data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="hint">{current.students.length} 位学生</span>
          </div>
          {!grading && <StudentRoster current={current} busy={busy} onCreate={create} />}
          {grading && <ClassBatchGrading current={current} workspace={workspace} />}
        </>
      )}
    </>
  );
}
