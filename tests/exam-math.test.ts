import { expect, it } from "vitest";
import { renderMathText } from "@/server/exams/math";

it("preserves every operand and operator in standalone inline math images", async () => {
  const images = await renderMathText(["计算：$2+3=$____；另有 $\\frac{1}{2}$。"]);
  const decode = (key: string) => Buffer.from(images[key].split(",")[1], "base64").toString("utf8");
  const arithmetic = decode("2+3=");
  for (const glyph of ["32", "2B", "33", "3D"]) expect(arithmetic).toContain(`data-c="${glyph}"`);
  expect(decode("\\frac{1}{2}")).toContain('data-c="31"');
  expect(decode("\\frac{1}{2}")).toContain('data-c="32"');
  expect(JSON.parse(JSON.stringify(images))["2+3="]).toBe(images["2+3="]);
});
