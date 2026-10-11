import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "./client";

export async function ensurePersonalWorkspace(user: { id: string; name: string }) {
  // Empty-update upserts can use a read/create sequence. If concurrent first
  // visits race, retry the complete transaction after the winning commit.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getDb().$transaction(async (tx) => {
        const workspace = await tx.workspace.upsert({
          where: { ownerId_kind: { ownerId: user.id, kind: "PERSONAL" } },
          create: { ownerId: user.id, name: `${user.name}的工作空间`, kind: "PERSONAL" },
          update: {},
        });
        await tx.workspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
          create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
          update: {},
        });
        return workspace;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002" || attempt === 2) throw error;
    }
  }
  throw new Error("Workspace initialization failed.");
}

export async function listUserWorkspaces(userId: string) {
  return getDb().workspace.findMany({
    where: { members: { some: { userId } } },
    select: { id: true, name: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
}
