import type { z } from "zod";
import type { practiceContentSchema } from "@/contracts/learning";
export function publicPracticeQuestions(content: z.infer<typeof practiceContentSchema> | null) {
  return content?.questions.map(({ id, stem, maxPoints, topicId }) => ({ id, stem, maxPoints, topicId })) ?? [];
}
