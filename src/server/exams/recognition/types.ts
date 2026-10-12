import type { z } from "zod";
import type {
  recognitionQuestionSchema,
  recognitionAnnotationsSchema,
  recognitionMetadataSchema,
} from "@/contracts/recognition";

export type RecognitionQuestion = z.infer<typeof recognitionQuestionSchema>;
export type RecognitionAnnotation = z.infer<
  typeof recognitionAnnotationsSchema
>["annotations"][number];
export type RecognitionMetadata = z.infer<typeof recognitionMetadataSchema>;
export type RecognitionFigure = RecognitionQuestion["figures"][number];
