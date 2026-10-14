import { withBasicMath } from "@/server/ai/prompts";

export const EXAM_PARSING_PROMPT = withBasicMath(
  "Extract every visible printed question from the uploaded pages into structured exam data, including subquestions, materials and explicit scores. Preserve source content and language, ignore student annotations, and mark cut-off content without inventing missing text.",
);
