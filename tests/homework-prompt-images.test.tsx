// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { HomeworkStudentPaper } from "@/contracts/homework";
import {
  PaperReading,
  StudentPrompt,
  type StudentItem,
} from "@/components/homework-collection/prompt";
const image = (n: number) =>
  `/api/platform/assets/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let host: HTMLDivElement, root: Root;
const item = (patch: Partial<StudentItem> = {}): StudentItem => ({
  id: "item1",
  position: 0,
  section: "",
  score: 10,
  type: "MIXED",
  stem: "题干",
  options: [],
  parts: [],
  studentImageUrls: [],
  ...patch,
});
const paper = (patch: Partial<HomeworkStudentPaper> = {}): HomeworkStudentPaper => ({
  id: "paper",
  name: "共享阅读",
  subject: "语文",
  instructions: "请阅读",
  textBlocks: [],
  studentImageUrls: [],
  items: [item()],
  ...patch,
});
const render = async (node: ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};
const images = () =>
  [...host.querySelectorAll("img")].map(
    (node) => new URL(node.getAttribute("src")!, "http://localhost:3000").pathname,
  );
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows an embedded stem image once while preserving loose gallery order", async () => {
  const value = item({
    stem: `题干 ![题面](${image(1)})`,
    studentImageUrls: [image(3), image(1), image(2)],
  });
  const original = structuredClone(value);
  await render(<StudentPrompt item={value} index={0} />);
  expect(images()).toEqual([image(1), image(3), image(2)]);
  expect(
    host.querySelector('section[aria-label="第 1 题题面图像材料"]')?.querySelectorAll("figure"),
  ).toHaveLength(2);
  expect(value).toEqual(original);
});
it("recognizes actual option and subquestion images instead of adding them again to the item gallery", async () => {
  await render(
    <StudentPrompt
      index={0}
      item={item({
        stem: `主图 ![主图](${image(1)})`,
        options: [{ label: "A", text: `选项 ![选项图](${image(2)})` }],
        parts: [
          {
            id: "part",
            type: "SINGLE",
            stem: `小问 ![小问图](${image(3)})`,
            options: [{ label: "A", text: `细节 ![细节图](${image(4)})` }],
            score: 10,
          },
        ],
        studentImageUrls: [image(1), image(2), image(3), image(4), image(5)],
      })}
    />,
  );
  expect(images().sort()).toEqual([1, 2, 3, 4, 5].map(image).sort());
  expect(
    host.querySelector('section[aria-label="第 1 题题面图像材料"]')?.querySelectorAll("img"),
  ).toHaveLength(1);
});
it("does not mistake ordinary links, inline code or fenced code for rendered images", async () => {
  const text = [
    `[查看图片](${image(1)})`,
    `\`![示例](${image(2)})\``,
    `\`\`\`md\n![示例](${image(3)})\n\`\`\``,
    `\\![转义](${image(4)})`,
  ].join("\n\n");
  await render(
    <StudentPrompt
      item={item({ stem: text, studentImageUrls: [1, 2, 3, 4].map(image) })}
      index={0}
    />,
  );
  expect(images()).toEqual([1, 2, 3, 4].map(image));
  expect(host.querySelector('a[href="' + image(1) + '"]')).not.toBeNull();
});
it("follows image AST URLs including titles and reference definitions", async () => {
  await render(
    <StudentPrompt
      item={item({
        stem: `![带标题](<${image(1)}> "题面图")\n\n![参考式][图一]\n\n[图一]: ${image(2)} "参考图"`,
        studentImageUrls: [image(1), image(2)],
      })}
      index={0}
    />,
  );
  expect(images()).toEqual([image(1), image(2)]);
  expect(host.querySelector('section[aria-label="第 1 题题面图像材料"]')).toBeNull();
});
it("uses the same math grammar as the visible Markdown renderer", async () => {
  await render(
    <StudentPrompt
      item={item({ stem: `$![数学文本](${image(1)})$`, studentImageUrls: [image(1)] })}
      index={0}
    />,
  );
  expect(images()).toEqual([image(1)]);
  expect(host.querySelector('section[aria-label="第 1 题题面图像材料"]')).not.toBeNull();
});
it("deduplicates paper gallery against instructions and position-specific shared blocks", async () => {
  const value = paper({
    instructions: `说明 ![说明图](${image(1)})`,
    textBlocks: [{ id: "reading", text: `阅读 ![阅读图](${image(2)})`, beforeQuestionId: "item1" }],
    studentImageUrls: [image(3), image(1), image(2)],
  });
  const original = structuredClone(value);
  await render(
    <>
      <PaperReading paper={value} />
      <PaperReading paper={value} beforeItemId="item1" />
      <StudentPrompt item={value.items[0]} index={0} />
    </>,
  );
  expect(images()).toEqual([image(1), image(3), image(2)]);
  expect(
    host.querySelector('section[aria-label="共享阅读纸级共享图像材料"]')?.querySelectorAll("img"),
  ).toHaveLength(1);
  expect(value).toEqual(original);
});
it("keeps paper-level loose images when a shared block only links to or quotes image syntax", async () => {
  const value = paper({
    instructions: `[材料链接](${image(1)})`,
    textBlocks: [{ id: "reading", text: `\`![代码](${image(2)})\`` }],
    studentImageUrls: [image(2), image(1)],
  });
  await render(<PaperReading paper={value} />);
  expect(images()).toEqual([image(2), image(1)]);
});
it("keeps each question's image independent even when another question embeds the same URL", async () => {
  await render(
    <>
      <StudentPrompt
        item={item({ stem: `第一题 ![图](${image(1)})`, studentImageUrls: [image(1)] })}
        index={0}
      />
      <StudentPrompt
        item={item({ id: "item2", stem: "第二题请看附图", studentImageUrls: [image(1)] })}
        index={1}
      />
    </>,
  );
  expect(images()).toEqual([image(1), image(1)]);
  expect(
    host.querySelector('section[aria-label="第 2 题题面图像材料"]')?.querySelectorAll("img"),
  ).toHaveLength(1);
});
it("does not suppress a paper-level attachment merely because a question embeds it", async () => {
  const value = paper({ studentImageUrls: [image(1)] });
  await render(
    <>
      <PaperReading paper={value} />
      <StudentPrompt
        item={item({ stem: `本题 ![图](${image(1)})`, studentImageUrls: [image(1)] })}
        index={0}
      />
    </>,
  );
  expect(images()).toEqual([image(1), image(1)]);
});
it("does not reuse a previous render's image set after a question changes", async () => {
  await render(
    <StudentPrompt
      item={item({ stem: `![旧图](${image(1)})`, studentImageUrls: [image(1)] })}
      index={0}
    />,
  );
  await render(
    <StudentPrompt item={item({ stem: "新题请看附图", studentImageUrls: [image(1)] })} index={0} />,
  );
  expect(images()).toEqual([image(1)]);
  expect(host.querySelector('section[aria-label="第 1 题题面图像材料"]')).not.toBeNull();
});
