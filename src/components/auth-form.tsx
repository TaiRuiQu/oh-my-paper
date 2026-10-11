"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@/lib/auth-client";
import { authFormSchema, type AuthFields } from "@/contracts/auth";

const authErrors: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确，请重新输入。",
  USER_ALREADY_EXISTS: "此邮箱已注册，请登录。",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "此邮箱已注册，请登录。",
  PASSWORD_TOO_SHORT: "密码至少需要 10 个字符。",
  PASSWORD_TOO_LONG: "密码最多 128 个字符。",
  TOO_MANY_REQUESTS: "尝试次数过多，请稍后再试。",
};

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const router = useRouter();
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AuthFields>({
    resolver: zodResolver(authFormSchema(mode)),
    defaultValues: { name: "", email: "", password: "" },
  });

  const submit = handleSubmit(async (values) => {
    setError(undefined);
    try {
      const result = registering
        ? await authClient.signUp.email({ name: values.name, email: values.email, password: values.password })
        : await authClient.signIn.email({ email: values.email, password: values.password });
      if (result.error) {
        setError(authErrors[result.error.code ?? ""] ?? "暂时无法完成操作，请稍后重试。");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("无法连接服务，请检查网络后重试。");
    }
  });

  return (
    <section className="auth-panel" aria-labelledby="auth-heading">
      <Link href="/" className="wordmark">Oh My Paper<span>试卷工作台</span></Link>
      <h1 id="auth-heading">{registering ? "创建你的账号" : "登录工作台"}</h1>
      <p className="intro">{registering ? "准备好你的试卷，接下来的事交给工作台。" : "让每一份作答，都有清晰的反馈。"}</p>
      <form onSubmit={submit} noValidate>
        {registering && <div className="field">
          <label htmlFor="name">姓名</label>
          <input id="name" autoComplete="name" maxLength={80} aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} {...register("name")} />
          {errors.name && <p id="name-error" className="field-error">{errors.name.message}</p>}
        </div>}
        <div className="field">
          <label htmlFor="email">邮箱</label>
          <input id="email" type="email" inputMode="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} {...register("email")} />
          {errors.email && <p id="email-error" className="field-error">{errors.email.message}</p>}
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input id="password" type="password" autoComplete={registering ? "new-password" : "current-password"} aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : registering ? "password-hint" : undefined} {...register("password")} />
          {errors.password ? <p id="password-error" className="field-error">{errors.password.message}</p> : registering && <p id="password-hint" className="hint">至少 10 个字符</p>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={isSubmitting}>{isSubmitting ? "正在处理…" : registering ? "创建账号" : "登录"}</button>
      </form>
      <p className="auth-switch">{registering ? "已有账号？" : "还没有账号？"} <Link href={registering ? "/login" : "/register"}>{registering ? "去登录" : "创建账号"}</Link></p>
    </section>
  );
}
