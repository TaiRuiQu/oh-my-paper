import "server-only";
import bwipjs from "bwip-js/node";
import type { Classroom } from "@/contracts/platform";
import { escapePrintText } from "@/lib/document-text";

/** A 42 × 24 mm cut-out label, including quiet space around the Code 128 bars. */
export function renderStudentBarcodeSvg(student: Classroom["students"][number], className: string) {
  if (!/^[0-9]{1,6}$/.test(student.studentNumber)) throw new Error("条码考号须为 1–6 位数字。");
  const studentNumber = student.studentNumber.padStart(6, "0");
  const bars = bwipjs
    .toSVG({
      bcid: "code128",
      text: studentNumber,
      scale: 2,
      height: 12,
      paddingwidth: 10,
      backgroundcolor: "FFFFFF",
    })
    .replace("<svg ", '<svg x="3" y="32" width="154" height="40" preserveAspectRatio="none" ');
  const name = escapePrintText(student.name);
  const classroom = escapePrintText(className);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90"><rect width="160" height="90" fill="white"/><g fill="black" font-family="sans-serif"><text x="80" y="13" font-size="11" text-anchor="middle" textLength="${Math.min(148, student.name.length * 11)}" lengthAdjust="spacingAndGlyphs">${name}</text><text x="80" y="26" font-size="9" text-anchor="middle" textLength="${Math.min(148, className.length * 9)}" lengthAdjust="spacingAndGlyphs">${classroom}</text>${bars}<text x="80" y="85" font-size="11" text-anchor="middle">${studentNumber}</text></g></svg>`;
}

export function renderBarcodeLabelPages(classroom: Classroom, copies: number): string[] {
  if (!Number.isInteger(copies) || copies < 1 || copies > 20)
    throw new Error("每人份数须为 1–20。");
  const labels = [...classroom.students]
    .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber))
    .flatMap((student) =>
      Array.from({ length: copies }, () => renderStudentBarcodeSvg(student, classroom.name)),
    );
  if (!labels.length) throw new Error("班级还没有学生，请先添加学生。");
  const pages: string[] = [];
  for (let offset = 0; offset < labels.length; offset += 40) {
    pages.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><rect width="794" height="1123" fill="white"/><text x="57" y="38" font-family="sans-serif" font-size="14">${escapePrintText(classroom.name)} · 考号条码标签 · 第 ${pages.length + 1} 页</text>${labels
        .slice(offset, offset + 40)
        .map(
          (label, index) =>
            `<g transform="translate(${57 + (index % 4) * 173},${66 + Math.floor(index / 4) * 100})"><rect x="-1" y="-1" width="162" height="92" fill="none" stroke="#999" stroke-width="0.5" stroke-dasharray="3 3"/>${label}</g>`,
        )
        .join(
          "",
        )}<text x="57" y="1100" font-family="sans-serif" font-size="10">A4 纵向 · 按 100% 打印，沿虚线裁切后平整粘贴；每人 ${copies} 份。</text></svg>`,
    );
  }
  return pages;
}
