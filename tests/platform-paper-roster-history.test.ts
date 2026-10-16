import { expect, it, vi } from "vitest";
import { executePapersCommand } from "@/server/platform/commands/papers";
const actor = { id: "teacher", name: "教师", role: "TEACHER" as const };
it.each(["paper.delete", "paper.save"] as const)(
  "protects a paper referenced only by roster history during %s",
  async (type) => {
    const paper = { id: "paper", ownerId: actor.id, items: [] };
    const db = {
      paper: {
        findUnique: vi.fn().mockResolvedValue(paper),
        findUniqueOrThrow: vi.fn().mockResolvedValue(paper),
        delete: vi.fn(),
        update: vi.fn(),
      },
      assessment: { count: vi.fn().mockResolvedValue(0) },
      assessmentParticipantSubject: { count: vi.fn().mockResolvedValue(1) },
    };
    const command =
      type === "paper.delete"
        ? { type, id: "paper" }
        : {
            type,
            paper: {
              id: "paper",
              name: "试卷",
              kind: "EXAM" as const,
              subject: "数学",
              grade: "高一",
              instructions: "",
              layout: { paperSize: "A4" as const, columns: 1 },
              items: [],
            },
          };
    await expect(
      executePapersCommand(
        db as unknown as Parameters<typeof executePapersCommand>[0],
        actor,
        command,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.paper.delete).not.toHaveBeenCalled();
    expect(db.paper.update).not.toHaveBeenCalled();
  },
);
