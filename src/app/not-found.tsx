import Link from "next/link";

export default function NotFoundPage() {
  return <main id="main" className="message-page"><h1>没有找到这个页面</h1><p>链接可能已更改。</p><Link className="button" href="/">返回工作台</Link></main>;
}
