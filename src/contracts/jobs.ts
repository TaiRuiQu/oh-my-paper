import { z } from "zod";

// Infrastructure only. Add versioned business task contracts when their data is available.
export const FRAMEWORK_PING_QUEUE = "framework.ping";
export const pingJobSchema = z.object({ message: z.string().min(1).max(100).default("ping") });
export type PingJob = z.infer<typeof pingJobSchema>;
