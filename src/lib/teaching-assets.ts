import type { TeachingPlan } from "@/contracts/teaching";
import { questionAssetUrls } from "./question-assets";

/** Call only after material references have been replaced with validated source snapshots. */
export function teachingPlanAssets(plan: TeachingPlan): string[] {
  const refs = new Set<string>();
  const text = (value: string) =>
    questionAssetUrls({ stem: value }).forEach((url) => refs.add(url));
  for (const value of Object.values(plan)) if (typeof value === "string") text(value);
  for (const activity of plan.activities)
    for (const value of Object.values(activity)) if (typeof value === "string") text(value);
  for (const material of plan.materials) {
    text(material.content);
    if (material.url) refs.add(material.url);
  }
  return [...refs];
}
