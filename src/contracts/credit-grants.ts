import { z } from "zod";
export const creditGrantSchema = z.strictObject({
  requestId: z.uuid(),
  amount: z.number().min(0.0001).max(1_000_000).multipleOf(0.0001),
});
