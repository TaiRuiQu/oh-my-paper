import "server-only";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { creditGrantSchema } from "@/contracts/credit-grants";
export async function grantCredits(
  adminId: string,
  userId: string,
  input: { requestId: string; amount: number },
) {
  const { requestId, amount } = creditGrantSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (admin?.role !== "ADMIN") throw new AccessError(403, "需要管理员权限。");
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AccessError(404, "用户不存在。");
    const previous = await tx.creditGrant.findUnique({ where: { id: requestId } });
    if (previous) {
      if (
        previous.userId !== userId ||
        previous.adminId !== adminId ||
        !previous.amount.equals(amount)
      )
        throw new RequestError(409, "请求已用于其他添加操作，请重新提交。");
      return { credits: user.credits.toFixed(8) };
    }
    if (user.role === "ADMIN") throw new RequestError(409, "管理员的 credit 不限量，无需添加。");
    await tx.creditGrant.create({ data: { id: requestId, userId, adminId, amount } });
    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: amount.toFixed(4) } },
    });
    return { credits: updated.credits.toFixed(8) };
  });
}
