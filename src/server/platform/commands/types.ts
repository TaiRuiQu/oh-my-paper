import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { commandSchema } from "../schemas";
export type Command = z.infer<typeof commandSchema>;
export type CommandContext = {
  db?: Prisma.TransactionClient;
  source?: "HUMAN" | "AI";
  jobId?: string;
};
