// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Exam } from "@/contracts/exams";
import { ExamContent } from "@/components/exam-result";
import { examMaterials } from "@/lib/exam-materials";

const box = { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.2 };
const exam: Exam = {
  id: "exam",
  name: "数学试卷",
  totalScore: 150,
  sections: [
    {
      id: "single",
      number: "一",
      title: "选择题",
      description: "只有一项符合题目要求。",
      score: 40,
      questions: [
        {
          id: "q8",
          number: 8,
          description: "如图，求 $AD$。\n\nA. $1$\nB. $2$",
          materials: [box],
          score: 5,
          subquestions: [],
        },
      ],
    },
    {
      id: "multiple",
      number: "二",
      title: "选择题",
      description: "有多项符合题目要求。",
      score: 18,
      questions: [
        {
          id: "q9",
          number: 9,
          description: "设 $z$ 是复数，则……",
          materials: [],
          score: 6,
          subquestions: [],
        },
      ],
    },
    {
      id: "written",
      number: "四",
      title: "解答题",
      description: "解答应写出证明过程。",
      score: 77,
      questions: [
        {
          id: "q15",
          number: 15,
          description: "已知正项数列，前 $n$ 项积为 $T_n$。",
          materials: [box],
          score: 13,
          subquestions: [
            { number: "(1)", description: "证明 $T_n$ 为等差数列。", materials: [], score: null },
            {
              number: "(2)",
              description: "(i) 求和；(ii) 证明结论。",
              materials: [box],
              score: null,
            },
          ],
        },
      ],
    },
  ],
};

function markup() {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(createElement(ExamContent, { exam, taskId: "task" }));
  return container;
}

describe("exam hierarchy presentation and materials", () => {
  it("displays section instructions once, original question numbers and nested part labels", () => {
    const container = markup();
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
      "一、选择题",
      "二、选择题",
      "四、解答题",
    ]);
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      "第 8 题",
      "第 9 题",
      "第 15 题",
    ]);
    expect([...container.querySelectorAll("h4")].map((heading) => heading.textContent)).toEqual([
      "(1)",
      "(2)",
    ]);
    expect(container.textContent!.split("只有一项符合题目要求。")).toHaveLength(2);
    expect(container.querySelector(".exam-question")?.textContent).not.toContain("只有一项");
    expect(container.querySelectorAll(".exam-question")).toHaveLength(3);
    expect(container.querySelectorAll(".exam-subquestion")).toHaveLength(2);
    expect(container.querySelectorAll(".exam-subquestion .task-status")).toHaveLength(0);
    expect(container.querySelectorAll(".exam-subquestion")[1].textContent).toContain(
      "(i) 求和；(ii) 证明结论。",
    );
  });

  it("uses the same crop keys for rendering, downloads and parsing across sections and subquestions", () => {
    const materials = examMaterials(exam);
    expect(materials.map((material) => material.key)).toEqual([
      "materials/1-1.jpg",
      "materials/3-1.jpg",
      "materials/3-2-1.jpg",
    ]);
    expect(materials.map((material) => material.questionNumber)).toEqual([8, 15, 15]);
    expect(materials[2].subquestionNumber).toBe("(2)");
    expect([...markup().querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(
      materials.map((material) => `/api/exams/task/files/${material.key}`),
    );
  });
});
