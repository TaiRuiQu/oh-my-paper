"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reportClientError } from "@/lib/error-message";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function signOut() {
    setPending(true);
    setError(undefined);
    try {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error(`退出失败（HTTP ${result.error.status}）：${result.error.message}`);
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setError(reportClientError("auth.signout", error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sign-out">
      <button className="button secondary" onClick={signOut} disabled={pending}>
        {pending ? "正在退出…" : "退出登录"}
      </button>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
