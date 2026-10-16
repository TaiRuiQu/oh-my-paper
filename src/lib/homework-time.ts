/** Convert a school wall-clock deadline without silently choosing a DST fold or gap. */
export function resolveHomeworkDeadline(dueLocal: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueLocal))
    throw new Error("截止时间必须包含有效日期、小时和分钟。");
  const [year, month, day, hour, minute] = dueLocal.split(/[-T:]/).map(Number);
  const stamp = Date.UTC(year, month - 1, day, hour, minute);
  const naive = new Date(stamp);
  if (
    year < 2000 ||
    year > 2200 ||
    naive.getUTCFullYear() !== year ||
    naive.getUTCMonth() !== month - 1 ||
    naive.getUTCDate() !== day ||
    naive.getUTCHours() !== hour ||
    naive.getUTCMinutes() !== minute
  )
    throw new Error("截止日期或时间无效。");
  if (!timezone || /^[+-]/.test(timezone)) throw new Error("请选择有效的学校 IANA 时区。");
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error("请选择有效的学校 IANA 时区。");
  }
  const localStamp = (instant: number) => {
    const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
  };
  // Probe both sides of possible transitions, including half-hour folds and date skips.
  // Candidate validation below, rather than a guessed offset, decides the result.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = stamp + hours * 3_600_000;
    offsets.add(localStamp(instant) - instant);
  }
  const candidates = [...offsets]
    .map((offset) => stamp - offset)
    .filter((v) => localStamp(v) === stamp);
  if (!candidates.length) throw new Error("该本地时间因时区调整而不存在，请选择其他截止时间。");
  if (candidates.length > 1)
    throw new Error("该本地时间因夏令时调整出现两次，请选择没有歧义的截止时间。");
  return new Date(candidates[0]);
}
