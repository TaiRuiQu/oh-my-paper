"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/http-client";
import { formatCredits } from "@/lib/credits";

export function CreditBalance({
  initialCredits,
  unlimited = false,
}: {
  initialCredits: string;
  unlimited?: boolean;
}) {
  const query = useQuery({
    queryKey: ["credit-balance"],
    queryFn: () => apiRequest<{ credits: string; unlimited?: boolean }>("/api/ai/settings"),
    initialData: { credits: initialCredits, unlimited },
    refetchInterval: 3000,
  });
  return (
    <Link
      className={`credit-balance${!query.data.unlimited && Number(query.data.credits) < 0 ? " is-negative" : ""}`}
      href="/ai-settings"
    >
      <span>AI 模型</span>
      <strong>
        {query.data.unlimited ? "不限量" : `${formatCredits(query.data.credits)} credit`}
      </strong>
    </Link>
  );
}
