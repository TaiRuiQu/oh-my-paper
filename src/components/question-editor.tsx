"use client";
import { Textarea } from "@/components/ui/textarea";
import { useState, type FormEvent } from "react";
import type { ExamQuestion } from "@/contracts/exams";
import { apiRequest, jsonBody } from "@/lib/http-client";
export function QuestionEditor({
  question,
  examId,
  outputKey,
  onSaved,
}: {
  question: ExamQuestion;
  examId: string;
  outputKey: string;
  onSaved: () => Promise<unknown>;
}) {
  const [selectedOptions, setSelectedOptions] = useState(
    question.solution?.selectedOptions.join(", ") ?? "",
  );
  const [answer, setAnswer] = useState(question.solution?.answer ?? "");
  const [explanation, setExplanation] = useState(question.solution?.explanation ?? "");
  const [rubric, setRubric] = useState(question.solution?.rubric ?? "");
  const [blockText, setBlockText] = useState(() =>
    question.blocks.map((b) => (b.type === "text" ? b.text : b.type === "math" ? b.latex : "")),
  );
  const [units, setUnits] = useState(() =>
    (question.answerTargets ?? []).map((target) => {
      const existing = question.solution?.units?.find((u) => u.targetKey === target.key);
      return (
        existing ?? {
          targetKey: target.key,
          answer: "",
          explanation: "",
          selectedOptions: [] as string[],
        }
      );
    }),
  );
  const [points, setPoints] = useState(String(question.points ?? ""));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/exams/${examId}`, {
        method: "PATCH",
        ...jsonBody({
          outputKey,
          questionId: question.id,
          points: points === "" ? null : Number(points),
          confirmed,
          solution: {
            answer,
            explanation,
            rubric,
            selectedOptions: selectedOptions.split(/[,，、\s]+/).filter(Boolean),
            units:
              units.length === 1
                ? [
                    {
                      ...units[0],
                      answer,
                      explanation,
                      selectedOptions: selectedOptions.split(/[,，、\s]+/).filter(Boolean),
                    },
                  ]
                : units,
            sufficient:
              !!answer.trim() && (units.length <= 1 || units.every((u) => u.answer.trim())),
            issues: answer.trim() ? [] : ["标准答案未填写。"],
          },
          blocks: question.blocks.map((b, index) =>
            b.type === "text"
              ? { ...b, text: blockText[index] }
              : b.type === "math"
                ? { ...b, latex: blockText[index] }
                : b,
          ),
        }),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改未保存，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="advanced-settings">
      <summary>编辑题目与标准答案</summary>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {question.blocks.map((block, index) =>
            block.type === "figure" || block.type === "table" ? (
              <p className="hint" key={index}>
                {block.type === "figure" ? `配图：${block.caption}` : "表格"}（保留原有位置）
              </p>
            ) : (
              <div className="field" key={index}>
                <label htmlFor={`edit-${question.id}-${index}`}>
                  {block.type === "math" ? "公式" : "题干"}
                </label>
                <Textarea
                  id={`edit-${question.id}-${index}`}
                  rows={4}
                  required
                  maxLength={12000}
                  value={blockText[index]}
                  onChange={(e) =>
                    setBlockText((old) =>
                      old.map((value, i) => (i === index ? e.target.value : value)),
                    )
                  }
                />
              </div>
            ),
          )}
          <div className="field">
            <label htmlFor={`points-${question.id}`}>本题满分</label>
            <input
              id={`points-${question.id}`}
              type="number"
              min={0}
              max={1000}
              step="0.01"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`answer-${question.id}`}>标准答案</label>
            <Textarea
              id={`answer-${question.id}`}
              rows={3}
              maxLength={12000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`selected-options-${question.id}`}>正确选项（选择题）</label>
            <input
              id={`selected-options-${question.id}`}
              value={selectedOptions}
              onChange={(e) => setSelectedOptions(e.target.value)}
              placeholder="例如：A，C"
            />
          </div>
          <div className="field">
            <label htmlFor={`explanation-${question.id}`}>答案解析</label>
            <Textarea
              id={`explanation-${question.id}`}
              rows={4}
              maxLength={16000}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`rubric-${question.id}`}>评分标准</label>
            <Textarea
              id={`rubric-${question.id}`}
              rows={3}
              maxLength={6000}
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
            />
          </div>
          {units.length > 1 &&
            units.map((unit, index) => {
              const target = question.answerTargets![index];
              const label =
                `${target.parentLabel ?? ""}${target.partLabel ?? ""}${target.blankIndex ? ` 第 ${target.blankIndex} 空` : ""}`.trim() ||
                `第 ${index + 1} 小问`;
              return (
                <div className="field" key={unit.targetKey}>
                  <label htmlFor={`unit-answer-${question.id}-${index}`}>{label}的正确答案</label>
                  <Textarea
                    id={`unit-answer-${question.id}-${index}`}
                    rows={2}
                    maxLength={12000}
                    value={unit.answer}
                    onChange={(event) =>
                      setUnits((old) =>
                        old.map((u, i) => (i === index ? { ...u, answer: event.target.value } : u)),
                      )
                    }
                  />
                  <label htmlFor={`unit-explanation-${question.id}-${index}`}>{label}的解析</label>
                  <Textarea
                    id={`unit-explanation-${question.id}-${index}`}
                    rows={2}
                    maxLength={16000}
                    value={unit.explanation}
                    onChange={(event) =>
                      setUnits((old) =>
                        old.map((u, i) =>
                          i === index ? { ...u, explanation: event.target.value } : u,
                        ),
                      )
                    }
                  />
                </div>
              );
            })}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            已对照原图核对题干、选项与小题
          </label>
          <button className="button secondary">{busy ? "保存中…" : "保存修正"}</button>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
