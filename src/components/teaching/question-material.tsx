import type { BankQuestion } from "@/contracts/platform";
import { QuestionBody } from "@/components/platform/questions";
import { QuestionAnswers } from "@/components/platform/question-answers";

export function TeachingQuestionMaterial({ content }: { content: string }) {
  let question: BankQuestion | null = null;
  try {
    const value = JSON.parse(content);
    if (
      value.source === "QUESTION_SNAPSHOT" &&
      value.content &&
      typeof value.content.stem === "string" &&
      Array.isArray(value.content.parts) &&
      Array.isArray(value.content.images) &&
      Array.isArray(value.content.options)
    ) {
      question = {
        id: value.questionId,
        ownerId: "",
        difficulty: 0,
        knowledgeTags: [],
        createdAt: "",
        updatedAt: value.updatedAt,
        subject: value.subject,
        grade: value.grade,
        type: value.type,
        content: value.content,
      };
    }
  } catch {
    /* The saved material must be a server-frozen question snapshot. */
  }
  return question ? (
    <>
      <p className="p-muted">
        已冻结题库材料 · {question.subject} · {question.grade}。编辑源题不会改写本次教案材料。
      </p>
      <QuestionBody question={question} />
      <details className="p-answers">
        <summary>查看此材料的参考答案与解析</summary>
        <QuestionAnswers content={question.content} />
      </details>
    </>
  ) : (
    <p className="p-muted">
      题目材料将在保存时从授权题库冻结。保存后可查看完整题体；若已保存仍不可读，请联系管理员核对。
    </p>
  );
}
