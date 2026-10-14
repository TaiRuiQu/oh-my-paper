export const BASIC_MATH_FORMAT =
  "Use LaTeX only for basic mathematical formulas. Avoid layout environments and commands for alignment, spacing, fonts, size or color; use Markdown for prose and tables.";

export function withBasicMath(goal: string) {
  return `${goal}\n\n${BASIC_MATH_FORMAT}`;
}
