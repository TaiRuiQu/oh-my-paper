import type { Role } from "./platform";

export const AREA_LABELS = {
  workspace: "首页",
  homework: "作业",
  exams: "考试",
  questions: "题库",
  learning: "我的学习",
  admin: "系统管理",
} as const;
export type PlatformArea = keyof typeof AREA_LABELS;
export type NavigationGroup = {
  area: PlatformArea;
  href: string;
  label: string;
  items: { href: string; label: string }[];
};

export function navigationFor(role: Role): NavigationGroup[] {
  if (role === "STUDENT")
    return [
      {
        area: "workspace",
        href: "/workspace",
        label: "首页",
        items: [{ href: "/workspace", label: "学习概览" }],
      },
      {
        area: "learning",
        href: "/learning/results",
        label: "我的学习",
        items: [
          { href: "/learning/results", label: "考试成绩" },
          { href: "/learning/reports", label: "学习报告" },
          { href: "/learning/knowledge", label: "知识点掌握" },
          { href: "/learning/wrong-questions", label: "我的错题" },
          { href: "/learning/practice", label: "巩固练习" },
        ],
      },
    ];
  const groups: NavigationGroup[] = [
    {
      area: "workspace",
      href: "/workspace",
      label: "首页",
      items: [
        { href: "/workspace", label: role === "ADMIN" ? "系统概览" : "教学概览" },
        { href: "/workspace/activity", label: "最近工作" },
        { href: "/workspace/classes", label: "班级与学生" },
      ],
    },
    {
      area: "homework",
      href: "/homework",
      label: "作业",
      items: [
        { href: "/homework", label: "作业管理" },
        { href: "/homework/new", label: "创建作业" },
        { href: "/homework/import", label: "图片识别作业" },
        { href: "/homework/assignments", label: "布置记录" },
        { href: "/homework/submissions", label: "作答录入" },
        { href: "/homework/grading", label: "作业批改" },
        { href: "/homework/reports", label: "成绩分析" },
        { href: "/homework/export", label: "导出作业" },
      ],
    },
    {
      area: "exams",
      href: "/exams",
      label: "考试",
      items: [
        { href: "/exams", label: "考试管理" },
        { href: "/exams/papers", label: "组卷工作台" },
        { href: "/exams/cards", label: "答题卡" },
        { href: "/exams/scanning", label: "扫描答题卡" },
        { href: "/exams/grading", label: "阅卷中心" },
        { href: "/exams/reports", label: "考试报告" },
      ],
    },
    {
      area: "questions",
      href: "/questions",
      label: "题库",
      items: [
        { href: "/questions", label: "题库管理" },
        { href: "/questions/import", label: "导入题目" },
        { href: "/questions/new", label: "创建题目" },
        { href: "/questions/knowledge", label: "知识点目录" },
        { href: "/questions/analysis", label: "题库分析" },
      ],
    },
  ];
  if (role === "ADMIN")
    groups.push({
      area: "admin",
      href: "/admin",
      label: "系统管理",
      items: [
        { href: "/admin", label: "系统报表" },
        { href: "/admin/users", label: "账号权限" },
        { href: "/admin/models", label: "模型接入" },
        { href: "/admin/jobs", label: "AI 任务" },
      ],
    });
  return groups;
}

export function areaForPath(path: string): PlatformArea {
  return (
    (Object.keys(AREA_LABELS) as PlatformArea[]).find(
      (area) => path === `/${area}` || path.startsWith(`/${area}/`),
    ) ?? "workspace"
  );
}
