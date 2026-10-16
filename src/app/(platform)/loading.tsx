export default function Loading() {
  return (
    <div role="status" aria-label="正在加载页面" className="p-page-loading">
      <div className="p-loading-title" />
      <div className="p-loading-line" />
      <div className="p-loading-surface" />
      <span>正在加载教学数据…</span>
    </div>
  );
}
