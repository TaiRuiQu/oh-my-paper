"use client";
import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser, AdminList } from "@/contracts/admin";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { formatDate } from "@/lib/date-time";
import { formatCredits } from "@/lib/credits";
import { AdminPagination } from "./admin-pagination";
import { CreditGrantForm } from "./credit-grant-form";
export function AdminUsers({ initialData }: { initialData: AdminList<AdminUser> }) {
  const client = useQueryClient();
  const [search, setSearch] = useState(""),
    [input, setInput] = useState(""),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{
    user: AdminUser;
    action: "profile" | "password" | "credits";
  } | null>(null);
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["admin-users", search, page],
    queryFn: () =>
      apiRequest<AdminList<AdminUser>>(
        `/api/admin/users?${new URLSearchParams({ search, page: String(page) })}`,
      ),
    initialData: !search && page === 1 ? initialData : undefined,
  });
  async function saved(message: string) {
    setSelected(null);
    setMessage(message);
    await client.invalidateQueries({ queryKey: ["admin-users"] });
  }
  function find(event: FormEvent) {
    event.preventDefault();
    setSearch(input.trim());
    setPage(1);
  }
  return (
    <>
      {message && <p role="status">{message}</p>}
      {selected?.action === "credits" ? (
        <CreditGrantForm
          user={selected.user}
          onSaved={async () => saved("额度已添加。")}
          onCancel={() => setSelected(null)}
        />
      ) : (
        selected && (
          <UserEditor
            key={`${selected.user.id}:${selected.action}`}
            user={selected.user}
            action={selected.action}
            onSaved={saved}
            onCancel={() => setSelected(null)}
          />
        )
      )}
      <section className="surface list-surface" aria-label="用户列表">
        <div className="list-toolbar">
          <h2>
            用户列表 <span className="count-label">{query.data?.total ?? ""}</span>
          </h2>
          <form className="inline-actions" onSubmit={find}>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />{" "}
              <input
                type="search"
                aria-label="搜索用户姓名或邮箱"
                placeholder="姓名或邮箱"
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <button className="button secondary">搜索</button>
          </form>
        </div>
        {query.error && (
          <p role="alert" className="form-error">
            {query.error.message}
            <button className="text-action" onClick={() => void query.refetch()}>
              重新加载
            </button>
          </p>
        )}
        {query.isPending ? (
          <p className="empty-state" role="status">
            正在加载用户…
          </p>
        ) : query.data?.items.length ? (
          <div className="table-scroll">
            <table className="management-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>角色</th>
                  <th>额度</th>
                  <th>试卷数</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((user) => (
                  <tr key={user.id}>
                    <td className="admin-record-owner">
                      {user.name}
                      <br />
                      <span className="hint">{user.email}</span>
                    </td>
                    <td>{user.role === "ADMIN" ? "管理员" : "用户"}</td>
                    <td>{user.role === "ADMIN" ? "不限量" : formatCredits(user.credits)}</td>
                    <td>{user.examCount}</td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td className="table-actions">
                      <button
                        className="text-action"
                        onClick={() => {
                          setMessage("");
                          setSelected({ user, action: "profile" });
                        }}
                      >
                        编辑用户
                      </button>
                      <button
                        className="text-action"
                        onClick={() => {
                          setMessage("");
                          setSelected({ user, action: "password" });
                        }}
                      >
                        重置密码
                      </button>
                      {user.role !== "ADMIN" && (
                        <button
                          className="text-action"
                          onClick={() => setSelected({ user, action: "credits" })}
                        >
                          添加额度
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !query.error && (
            <div className="empty-state">
              <h3>没有找到用户</h3>
              <p>请尝试其他姓名或邮箱。</p>
            </div>
          )
        )}
        {query.data && <AdminPagination data={query.data} onPage={setPage} />}
      </section>
    </>
  );
}
function UserEditor({
  user,
  action,
  onSaved,
  onCancel,
}: {
  user: AdminUser;
  action: "profile" | "password";
  onSaved: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(user.name),
    [role, setRole] = useState(user.role),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (action === "password" && password !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ success: boolean; signedOut?: boolean }>(
        `/api/admin/users/${encodeURIComponent(user.id)}${action === "password" ? "/password" : ""}`,
        {
          method: action === "password" ? "POST" : "PATCH",
          ...jsonBody(action === "password" ? { password } : { name, role }),
        },
      );
      setPassword("");
      setConfirm("");
      if (result.signedOut) {
        router.replace("/login");
        router.refresh();
        return;
      }
      await onSaved(
        action === "password"
          ? `已重置 ${user.name} 的密码，原有登录会话已退出。`
          : "用户资料已保存。",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface admin-user-editor">
      <h2>
        {action === "password" ? "重置密码" : "编辑用户"} · {user.name}
      </h2>
      <p className="intro admin-record-owner">{user.email}</p>
      <form onSubmit={submit} aria-busy={busy}>
        {action === "password" ? (
          <>
            <p className="hint">设置新密码后，该用户的所有登录会话都会退出。请将新密码告知用户。</p>
            <div className="field">
              <label htmlFor="reset-password">新密码</label>
              <input
                autoFocus
                id="reset-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="hint">10–128 个字符。</p>
            </div>
            <div className="field">
              <label htmlFor="reset-password-confirm">确认新密码</label>
              <input
                id="reset-password-confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                disabled={busy}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="edit-user-name">姓名</label>
              <input
                autoFocus
                id="edit-user-name"
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-user-role">角色</label>
              <select
                id="edit-user-role"
                value={role}
                disabled={busy}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="USER">用户</option>
                <option value="ADMIN">管理员</option>
              </select>
              <p className="hint">角色变更后，该用户需要重新登录。</p>
            </div>
          </>
        )}
        <div className="inline-actions">
          <button className="button" disabled={busy}>
            {busy ? "正在保存" : action === "password" ? "确认重置密码" : "保存用户"}
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
    </section>
  );
}
