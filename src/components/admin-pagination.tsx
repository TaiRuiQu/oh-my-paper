"use client";
export function AdminPagination({
  data,
  onPage,
}: {
  data: { page: number; pageSize: number; total: number };
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <nav className="admin-pagination" aria-label="记录分页">
      <span className="hint">
        第 {data.page} / {pages} 页 · 共 {data.total} 条
      </span>
      <button
        className="button secondary"
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        上一页
      </button>
      <button
        className="button secondary"
        disabled={data.page >= pages}
        onClick={() => onPage(data.page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
