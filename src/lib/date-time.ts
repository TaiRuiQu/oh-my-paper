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
