import Link from "next/link";
import { requirePageSession } from "@/server/auth/session";
import { learningOverview } from "@/server/learning/service";
import { classOverview } from "@/server/learning/classes";
import { WrongQuestions } from "@/components/wrong-questions";
export const metadata = { title: "学情分析" };
export default async function Page() {
  const { user } = await requirePageSession();
  const [learning, classes] = await Promise.all([
    learningOverview(user.id),
    classOverview(user.id),
  ]);
  return (
    <>
      <div className="workspace-heading">
        <h1>学情分析</h1>
        <p className="intro">查看班级作答情况，整理错题，并通过 AI 推荐的相似题巩固练习。</p>
      </div>
      {!!classes.length && (
        <section className="class-analysis">
          <h2>班级批改概览</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>班级</th>
                  <th>学生数</th>
                  <th>批次</th>
                  <th>已完成作答</th>
                  <th>待核对题目</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.students.length}</td>
                    <td>{c.batches.length}</td>
                    <td>
                      {
                        c.batches.flatMap((b) => b.exams).filter((e) => e.status === "批改完成")
                          .length
                      }
                    </td>
                    <td>
                      {c.batches.flatMap((b) => b.exams).reduce((n, e) => n + (e.pending ?? 0), 0)}
                    </td>
                    <td>
                      <Link href="/grading?mode=batch">查看批改报告</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <WrongQuestions initialData={learning} embedded />
    </>
  );
}
