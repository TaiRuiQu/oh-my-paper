// Explicit locale and timezone keep server-rendered and hydrated text identical.
const options = { timeZone: "Asia/Shanghai" };
const date = new Intl.DateTimeFormat("zh-CN", {
  ...options,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
const time = new Intl.DateTimeFormat("zh-CN", {
  ...options,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function formatDate(value: string) {
  return date.format(new Date(value));
}
export function formatTime(value: string) {
  return time.format(new Date(value));
}
export function formatDateTime(value: string) {
  return `${formatDate(value)} ${formatTime(value)}`;
}
// Homework and practice receipts share one school-timezone formatter so both domains render
// identical wall-clock text instead of falling back to the device timezone.
const schoolFormats = new Map<string, Intl.DateTimeFormat>();
export function formatSchoolDateTime(value: string, timezone: string) {
  let format = schoolFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    schoolFormats.set(timezone, format);
  }
  return format.format(new Date(value));
}
