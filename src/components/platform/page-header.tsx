import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PageHeader({
  title,
  titleEditor,
  description,
  actions,
  back,
}: {
  title: string;
  titleEditor?: ReactNode;
  description: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <>
      {back && (
        <Link className="p-back" href={back.href}>
          <ArrowLeft size={14} />
          {back.label}
        </Link>
      )}
      <div className="p-heading">
        <div>
          {titleEditor ?? <h1>{title}</h1>}
          <p>{description}</p>
        </div>
        {actions && <div className="p-actions">{actions}</div>}
      </div>
    </>
  );
}

export function PageTabs({
  links,
  active,
}: {
  links: { href: string; label: string }[];
  active: string;
}) {
  return (
    <nav className="p-page-tabs" aria-label="工作台页面">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.href === active ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function MissingRecord({ back }: { back: string }) {
  return (
    <div className="p-panel p-panel-content">
      <h2>内容不存在或无权访问</h2>
      <p className="p-muted">请回到列表选择你有权限查看的内容。</p>
      <Button asChild variant="outline">
        <Link href={back}>返回列表</Link>
      </Button>
    </div>
  );
}
