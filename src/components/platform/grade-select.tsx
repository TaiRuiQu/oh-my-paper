import type { SelectHTMLAttributes } from "react";
const numerals = ["一", "二", "三", "四", "五", "六"];
export const GRADE_GROUPS = [
  { label: "小学", count: 6 },
  { label: "初中", count: 4 },
  { label: "高中", count: 3 },
];
export function normalizeGrade(value?: string) {
  if (!value) return "高中一年级";
  const aliases: Record<string, string> = {
    高一: "高中一年级",
    高二: "高中二年级",
    高三: "高中三年级",
    初一: "初中一年级",
    初二: "初中二年级",
    初三: "初中三年级",
    初四: "初中四年级",
  };
  return aliases[value] ?? (numerals.some((n) => value === `${n}年级`) ? `小学${value}` : value);
}
export function GradeSelect({
  emptyLabel,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { emptyLabel?: string }) {
  const gradeValue = (value: string) => (value === "" && emptyLabel ? "" : normalizeGrade(value));
  return (
    <select
      {...props}
      value={props.value === undefined ? undefined : gradeValue(String(props.value))}
      defaultValue={
        props.defaultValue === undefined ? undefined : gradeValue(String(props.defaultValue))
      }
    >
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {GRADE_GROUPS.map((group) => (
        <optgroup label={group.label} key={group.label}>
          {numerals.slice(0, group.count).map((n) => (
            <option key={n} value={`${group.label}${n}年级`}>
              {group.label}
              {n}年级
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
