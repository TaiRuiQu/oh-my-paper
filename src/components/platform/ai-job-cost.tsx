import type { AiJobDTO } from "@/contracts/platform-ai";
import { aiCostLabel, aiCostUnavailableReason, formatAiCost } from "@/lib/ai-cost-display";
import { formatDateTime } from "@/lib/date-time";
import styles from "./ai-job-cost.module.css";

export function AIJobCost({ job, compact = false }: { job: AiJobDTO; compact?: boolean }) {
  if (job.status !== "COMPLETED" && job.status !== "FAILED") return null;
  const cost = job.cost;
  if (compact) return <p className={styles.compact}>{aiCostLabel(cost)}</p>;
  return (
    <details className={styles.cost} aria-label="本次任务成本">
      <summary>{aiCostLabel(cost)}</summary>
      <div className={styles.details}>
        {cost?.status !== "estimated" && <p>{aiCostUnavailableReason(cost)}</p>}
        {cost && (
          <dl>
            {cost.usd !== null && (
              <div>
                <dt>美元成本</dt>
                <dd>{formatAiCost(cost.usd, "USD")}</dd>
              </div>
            )}
            {cost.exchangeRate && (
              <div>
                <dt>换算汇率</dt>
                <dd>1 美元 = {cost.exchangeRate.usdToCny} 元人民币</dd>
              </div>
            )}
            {cost.pricing && (
              <div>
                <dt>参考价格</dt>
                <dd>
                  {cost.pricing.provider} / {cost.pricing.model}
                </dd>
              </div>
            )}
            {cost.pricing && (
              <div>
                <dt>价格获取时间</dt>
                <dd>{formatDateTime(cost.pricing.fetchedAt)}</dd>
              </div>
            )}
            {cost.exchangeRate && (
              <div>
                <dt>汇率更新时间</dt>
                <dd>{formatDateTime(cost.exchangeRate.updatedAt)}</dd>
              </div>
            )}
          </dl>
        )}
        {cost?.exchangeRate.source === "fallback" && (
          <p>动态汇率获取失败，使用 {formatDateTime(cost.exchangeRate.updatedAt)} 的备用汇率。</p>
        )}
        <p>
          按模型用量与公开价格估算，实际扣费以供应商账单为准。
          {cost?.pricing?.match === "reference" && "当前接入使用目录中的参考价格。"}
          {job.status === "FAILED" && "仅包含已记录调用，任务中断时可能还有未返回用量的费用。"}
        </p>
        <p>
          价格来源：
          <a href="https://models.dev/" target="_blank" rel="noreferrer">
            models.dev
          </a>
          {cost?.exchangeRate && (
            <>
              {" "}
              · 汇率来源：
              <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">
                ExchangeRate-API
              </a>
            </>
          )}
        </p>
      </div>
    </details>
  );
}
