import type { QuestionReviewRule, Review } from "@/contracts/platform";
import { exceedsReviewDifference } from "./document-layout";

export type ReviewRoundChoice = {
  round: Review["round"];
  label: string;
  reason: string | null;
};

// Mirrors review.save's ownership and round constraints. The server remains authoritative.
export function reviewRoundAvailability({
  reviewerId,
  reviews,
  policy,
  published = false,
}: {
  reviewerId: string;
  reviews: Review[];
  policy: QuestionReviewRule;
  published?: boolean;
}): ReviewRoundChoice[] {
  const first = reviews.find((review) => review.round === "FIRST");
  const second = reviews.find((review) => review.round === "SECOND");
  const arbitration = reviews.find((review) => review.round === "ARBITRATION");
  const choices = [
    ["FIRST", "第一评"],
    ["SECOND", "第二评"],
    ["ARBITRATION", "仲裁三评"],
  ] as const;
  return choices.map(([round, label]) => {
    let reason: string | null = null;
    const previous = reviews.find((review) => review.round === round);
    if (published) reason = "成绩已发布，请先撤回发布";
    else if (previous && previous.reviewerId !== reviewerId) reason = "本轮已由其他教师提交";
    else if (round !== "FIRST" && !policy.doubleReview) reason = "本题采用单评";
    else if (round !== "ARBITRATION" && arbitration) reason = "仲裁已完成，前两评已锁定";
    else if (
      (round === "FIRST" && second?.reviewerId === reviewerId) ||
      (round === "SECOND" && first?.reviewerId === reviewerId)
    )
      reason = "同一道题的前两评须由不同教师完成";
    else if (round === "ARBITRATION") {
      if (!policy.arbitrationEnabled) reason = "本题未启用仲裁";
      else if (!first || !second || first.source === "AI") reason = "须先完成教师第一评与第二评";
      else if ([first.reviewerId, second.reviewerId].includes(reviewerId))
        reason = "仲裁须由未参与前两评的第三位教师完成";
      else if (!exceedsReviewDifference(first.score, second.score, policy.maxDifference))
        reason = "前两评分差未超出仲裁阈值";
    }
    return { round, label, reason };
  });
}
