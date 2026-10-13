"use client";
import { useRef, useState, type FormEvent } from "react";
import { apiRequest, jsonBody } from "@/lib/http-client";
export function CreditGrantForm({
  user,
  onSaved,
  onCancel,
}: {
  user: { id: string; name: string };
  onSaved: (amount: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("100"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ id: string; amount: number } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = Number(amount);
    if (!request.current || request.current.amount !== value)
      request.current = { id: crypto.randomUUID(), amount: value };
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}/credits`, {
        method: "POST",
        ...jsonBody({ requestId: request.current.id, amount: value }),
      });
      // Keep the request ID if refreshing the ranking fails after settlement.
      await onSaved(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : "添加失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="surface credit-grant-form"
      onSubmit={submit}
      aria-label={`为${user.name}添加 credit`}
    >
      <h2>为 {user.name} 添加 credit</h2>
      <div className="field">
        <label htmlFor="credit-grant-amount">添加额度</label>
        <input
          autoFocus
          id="credit-grant-amount"
          type="number"
          min="0.0001"
          max="1000000"
          step="0.0001"
          required
          disabled={busy}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className="inline-actions">
        <button className="button" disabled={busy}>
          {busy ? "正在添加" : "添加 credit"}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
