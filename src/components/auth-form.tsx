"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { reportClientError } from "@/lib/error-message";
import { authClient } from "@/lib/auth-client";
import { authLoginSchema, type AuthFields } from "@/contracts/auth";

const authErrors: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: "账号或密码不正确，请重新输入。",
  INVALID_USERNAME: "账号格式不正确，请检查后重新输入。",
  TOO_MANY_REQUESTS: "尝试次数过多，请稍后再试。",
};

export function AuthForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthFields>({
    resolver: zodResolver(authLoginSchema),
    defaultValues: { username: "", password: "" },
  });
  const submit = handleSubmit(async (values) => {
    setError(undefined);
    try {
      const result = await authClient.signIn.username(values);
      if (result.error) {
        setError(authErrors[result.error.code ?? ""] ?? "登录失败，请稍后重试。");
        return;
      }
      router.replace("/xiaozhi");
      router.refresh();
    } catch (error) {
      setError(reportClientError("auth.submit", error));
    }
  });
  return (
    <section className="auth-panel" aria-labelledby="auth-heading">
      <Link href="/" className="wordmark">
        Oh My Paper<span>教学工作台</span>
      </Link>
      <h1 id="auth-heading">登录工作台</h1>
      <p className="intro">从一道题到一场考试，让教学工作有序衔接。</p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="username">账号 / 学号</label>
          <input
            id="username"
            autoComplete="username"
            maxLength={254}
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? "username-error" : undefined}
            {...register("username")}
          />
          {errors.username && (
            <p id="username-error" className="field-error">
              {errors.username.message}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password && (
            <p id="password-error" className="field-error">
              {errors.password.message}
            </p>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "正在登录…" : "登录"}
        </button>
      </form>
      <p className="auth-switch">账号由管理员分配，学生账号也可由教师添加。学生请使用学号登录。</p>
    </section>
  );
}
