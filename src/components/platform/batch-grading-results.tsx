import Link from "next/link";
import type { GradingResult } from "@/contracts/platform-ai";
import { Panel } from "./primitives";

export function GradingResults({ result }: { result: GradingResult }) {
  const base = result.assessmentKind === "HOMEWORK" ? "/homework" : "/exams";
  return (
    <>
      {!!result.students.length && (
        <Panel title={`已处理 ${result.students.length} 位学生`}>
          <div className="p-table" role="region" aria-label="班级批改结果" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>学生</th>
                  <th>已评分</th>
                  <th>待核对</th>
                  <th>作答与评分</th>
                </tr>
              </thead>
              <tbody>
                {result.students.map((student) => (
                  <tr key={student.studentId}>
                    <td>{student.name}</td>
                    <td>{student.gradedQuestions} 题</td>
                    <td>{student.skippedQuestions} 题</td>
                    <td>
                      <Link href={`${base}/grading/${encodeURIComponent(student.submissionId)}`}>
                        核对批改
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {!!result.pendingPages.length && (
        <Panel
          title={`扫描异常 · ${result.pendingPages.length} 页`}
          description="请查看原图，核对模板与扫描质量，并在学生的作答与评分页人工补录未评分题目。"
        >
          <ul>
            {result.pendingPages.map((page, index) => (
              <li key={page.sourceUrl}>
                <a href={page.sourceUrl} target="_blank" rel="noreferrer">
                  查看第 {index + 1} 页原图
                </a>
                {" · "}
                {page.reason}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
