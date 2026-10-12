"use client";
import Link from "next/link";
import type { FormEvent } from "react";
import type { ClassroomSummary } from "@/contracts/classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export function StudentRoster({
  current,
  busy,
  onCreate,
}: {
  current: ClassroomSummary;
  busy: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>, path: string) => Promise<void>;
}) {
  return (
    <>
      <details className="advanced-settings" open={!current.students.length}>
        <summary>添加学生</summary>
        <form onSubmit={(e) => void onCreate(e, "/api/classes/students")}>
          <Input type="hidden" name="classroomId" value={current.id} />
          <div className="grading-input-pair">
            <div className="field">
              <label htmlFor="student-name">学生姓名</label>
              <Input id="student-name" name="name" required maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="student-number">学号</label>
              <Input id="student-number" name="number" required maxLength={40} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="student-email">学生账号邮箱（可选）</label>
            <Input id="student-email" name="email" type="email" />
            <p className="hint">关联已注册的账号后，学生可在自己的错题本中复习。</p>
          </div>
          <button className="button secondary" disabled={busy}>
            保存学生
          </button>
        </form>
      </details>
      <section className="student-list">
        <div className="section-heading">
          <h2>学生名单</h2>
          <span className="hint">共 {current.students.length} 位学生</span>
        </div>
        {current.students.length ? (
          <div className="table-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>学号</TableHead>
                  <TableHead>学生姓名</TableHead>
                  <TableHead>账号关联</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.number}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{s.linked ? "已关联" : "未关联"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="history-empty muted">班级内还没有学生，请先添加学生。</p>
        )}
        <Button asChild variant="outline">
          <Link href="/grading?mode=batch">进入批量改卷</Link>
        </Button>
      </section>
    </>
  );
}
