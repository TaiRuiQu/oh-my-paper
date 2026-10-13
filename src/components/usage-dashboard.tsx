"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UsageDashboard, UsageTotals } from "@/contracts/usage";
import { CreditGrantForm } from "./credit-grant-form";
import { apiRequest } from "@/lib/http-client";
import { creditUnits, formatCredits } from "@/lib/credits";
const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
export function UsageDashboardPanel({ initialData }: { initialData: UsageDashboard }) {
  const [grantUser, setGrantUser] = useState<{ id: string; name: string } | null>(null);
  const [grantNotice, setGrantNotice] = useState("");
  const [sort, setSort] = useState<"credits" | "tokens">("credits");
  const query = useQuery({
    queryKey: ["admin-usage"],
    queryFn: () => apiRequest<UsageDashboard>("/api/admin/usage"),
    initialData,
    refetchInterval: 5000,
  });
  const data = query.data;
  const ranking = <T extends UsageTotals & { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => {
      const difference =
        sort === "credits"
          ? creditUnits(b.credits) - creditUnits(a.credits)
          : BigInt(b.inputTokens + b.outputTokens - a.inputTokens - a.outputTokens);
      return difference < 0n ? -1 : difference > 0n ? 1 : a.id.localeCompare(b.id, "en");
    });
  return (
    <>
      <section className="surface usage-overview" aria-labelledby="usage-total-title">
        <div className="section-heading">
          <h2 id="usage-total-title">系统累计消耗</h2>
          <span className="hint">每 5 秒更新</span>
        </div>
        <dl className="usage-totals">
          <div>
            <dt>Credit 消耗</dt>
            <dd>{formatCredits(data.totals.credits)}</dd>
          </div>
          <div>
            <dt>总 token</dt>
            <dd>{number(data.totals.inputTokens + data.totals.outputTokens)}</dd>
          </div>
          <div>
            <dt>模型调用</dt>
            <dd>{number(data.totals.calls)}</dd>
          </div>
        </dl>
        <p className="hint">
          输入 {number(data.totals.inputTokens)} · 输出 {number(data.totals.outputTokens)} ·
          缓存命中输入 {number(data.totals.cachedTokens)}。总 token = 输入 +
          输出，缓存命中量包含在输入中。
        </p>
        <p className="hint">
          包含失败任务和重试中已返回用量的调用。从 credit
          机制启用时开始统计，管理员用量仍折算记录，但不扣减余额。
        </p>
      </section>
      {query.error && (
        <p className="form-error" role="alert">
          统计暂时无法刷新。
          <button className="text-action" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      )}
      <div className="usage-ranking-toolbar">
        <label htmlFor="usage-sort">排行榜排序</label>
        <select
          id="usage-sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as "credits" | "tokens")}
        >
          <option value="credits">按 credit 消耗</option>
          <option value="tokens">按总 token 消耗</option>
        </select>
      </div>
      {grantNotice && (
        <p className="hint" role="status">
          {grantNotice}
        </p>
      )}
      {grantUser && (
        <CreditGrantForm
          key={grantUser.id}
          user={grantUser}
          onCancel={() => setGrantUser(null)}
          onSaved={async (amount) => {
            const refreshed = await query.refetch();
            if (refreshed.error) throw refreshed.error;
            setGrantNotice(
              `已为 ${grantUser.name} 添加 ${formatCredits(amount.toFixed(4))} credit。`,
            );
            setGrantUser(null);
          }}
        />
      )}
      <section className="surface usage-ranking" aria-labelledby="user-usage-title">
        <div className="list-heading">
          <h2 id="user-usage-title">用户消耗排行榜</h2>
          <span className="hint">{data.users.length} 位用户</span>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="用户消耗表格，可横向滚动"
        >
          <table className="management-table usage-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>用户</th>
                <th>Credit 消耗</th>
                <th>总 token</th>
                <th>输入</th>
                <th>输出</th>
                <th>缓存命中</th>
                <th>余额</th>
                <th>额度管理</th>
              </tr>
            </thead>
            <tbody>
              {ranking(data.users).map((user, index) => (
                <tr key={user.id}>
                  <td>{index + 1}</td>
                  <td>
                    <strong>{user.name}</strong>
                  </td>
                  <UsageCells usage={user} />
                  <td className={!user.unlimited && Number(user.balance) < 0 ? "form-error" : ""}>
                    {user.unlimited ? "不限量" : formatCredits(user.balance)}
                  </td>
                  <td>
                    {!user.unlimited && (
                      <button
                        className="button secondary"
                        aria-label={`为${user.name}添加 credit`}
                        onClick={() => {
                          setGrantNotice("");
                          setGrantUser({ id: user.id, name: user.name });
                        }}
                      >
                        添加 credit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!data.users.length && (
                <tr>
                  <td colSpan={9}>暂无用户。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="surface usage-ranking" aria-labelledby="model-usage-title">
        <div className="list-heading">
          <h2 id="model-usage-title">模型消耗排行榜</h2>
          <span className="hint">{data.models.length} 个模型</span>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="模型消耗表格，可横向滚动"
        >
          <table className="management-table usage-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>模型</th>
                <th>Credit 消耗</th>
                <th>总 token</th>
                <th>输入</th>
                <th>输出</th>
                <th>缓存命中</th>
                <th>调用次数</th>
              </tr>
            </thead>
            <tbody>
              {ranking(data.models).map((model, index) => (
                <tr key={model.id}>
                  <td>{index + 1}</td>
                  <td>
                    <strong title={model.apiModel}>{model.name}</strong>
                    <span className="table-note">{model.provider}</span>
                  </td>
                  <UsageCells usage={model} />
                  <td>{number(model.calls)}</td>
                </tr>
              ))}
              {!data.models.length && (
                <tr>
                  <td colSpan={8}>暂无模型用量，任务执行后会自动记录。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function UsageCells({ usage }: { usage: UsageTotals }) {
  return (
    <>
      <td>{formatCredits(usage.credits)}</td>
      <td>{number(usage.inputTokens + usage.outputTokens)}</td>
      <td>{number(usage.inputTokens)}</td>
      <td>{number(usage.outputTokens)}</td>
      <td>{number(usage.cachedTokens)}</td>
    </>
  );
}
