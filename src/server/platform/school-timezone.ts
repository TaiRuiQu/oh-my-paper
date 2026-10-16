import "server-only";
import type { Db } from "./access";

/** Latest term defines the school timezone; display DTOs pass it down instead of the device zone. */
export async function schoolTimezone(db: Db): Promise<string> {
  const term = await db.schoolTerm.findFirst({
    orderBy: { startDate: "desc" },
    select: { timezone: true },
  });
  return term?.timezone ?? "Asia/Shanghai";
}
