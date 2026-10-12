import { z } from "zod";
import { contentBlockSchema, questionSolutionSchema } from "./exams";
import { pointsSchema } from "./grading";
export const examEditSchema = z.object({ outputKey: z.uuid(), questionId: z.string().min(1).max(100), blocks: z.array(contentBlockSchema).min(1).max(100), points: pointsSchema.nullable(), solution: questionSolutionSchema.optional(), confirmed: z.boolean() });
