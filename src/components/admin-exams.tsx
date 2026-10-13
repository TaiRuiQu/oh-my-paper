"use client";
import Link from "next/link";
import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminExam, AdminList } from "@/contracts/admin";
import { apiRequest } from "@/lib/http-client";
import { formatDate } from "@/lib/date-time";
import { StatusBadge } from "./processing-state";
import { AdminPagination } from "./admin-pagination";
export function AdminExams({ initialData }: { initialData: AdminList<AdminExam> }) {
  const [search, setSearch] = useState(""),
    [input, setInput] = useState(""),
    [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["admin-exams", search, page],
    queryFn: () =>
      apiRequest<AdminList<AdminExam>>(
        `/api/admin/exams?${new URLSearchParams({ search, page: String(page) })}`,
      ),
    initialData: !search && page === 1 ? initialData : undefined,
    refetchInterval: 5000,
  });
  function find(event: FormEvent) {
    event.preventDefault();
    setSearch(input.trim());
    setPage(1);
  }
  return (
    <section className="surface list-surface" aria-label="全系统试卷记录">
      <div className="list-toolbar">
        <h2>
          试卷记录 <span className="count-label">{query.data?.total ?? ""}</span>
        </h2>
        <form className="inline-actions" onSubmit={find}>
          <label className="search-field">
            <Search size={17} aria-hidden="true" />{" "}
            <input
              aria-label="搜索试卷名称、用户姓名或邮箱"
              type="search"
              placeholder="试卷名称、姓名或邮箱"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <button className="button secondary">搜索</button>
        </form>
      </div>
      {query.error && (
        <p className="form-error" role="alert">
          {query.error.message}
          <button className="text-action" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      )}
      {query.isPending ? (
        <p className="empty-state" role="status">
          正在加载试卷…
        </p>
      ) : query.data?.items.length ? (
        <div className="table-scroll">
          <table className="management-table">
            <thead>
              <tr>
                <th>试卷名称</th>
                <th>所属用户</th>
                <th>来源</th>
                <th>添加时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((task) => (
                <tr key={task.id}>
                  <td>
                    <Link className="table-title" href={`/admin/exams/${task.id}`}>
                      {task.name}
                    </Link>
                  </td>
                  <td className="admin-record-owner">
                    {task.owner.name}
                    <br />
                    <span className="hint">{task.owner.email}</span>
                  </td>
                  <td>{task.source}</td>
                  <td>{formatDate(task.createdAt)}</td>
                  <td>
                    <StatusBadge status={task.status} />
                    {task.deletedAt && <span className="hint"> · 用户已删除</span>}
                  </td>
                  <td>
                    <Link className="text-action" href={`/admin/exams/${task.id}`}>
                      审查记录
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !query.error && (
          <div className="empty-state">
            <h3>{search ? "没有找到匹配的记录" : "暂无试卷记录"}</h3>
            <p>{search ? "请尝试其他名称或邮箱。" : "用户上传试卷后会显示在这里。"}</p>
          </div>
        )
      )}
      {query.data && <AdminPagination data={query.data} onPage={setPage} />}
    </section>
  );
}
