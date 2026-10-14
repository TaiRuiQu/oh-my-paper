"use client";
import type { ReactNode } from "react";
import type { AccountCredentials } from "@/contracts/auth";

export function AccountCredentialsPanel({ credentials, children }: { credentials: AccountCredentials; children?: ReactNode }) {
  return <div className="p-form" role="status">
    <h3>账号已创建</h3>
    <p>请保存以下登录信息并交给账号使用者。离开页面后将无法再次查看此密码。</p>
    <dl>
      <dt>账号 / 学号</dt><dd>{credentials.username}</dd>
      <dt>初始密码</dt><dd>{credentials.password}</dd>
    </dl>
    {children}
  </div>;
}
