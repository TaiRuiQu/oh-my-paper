import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import packageInfo from "../../package.json";
import "@fontsource-variable/geist";
import "@fontsource-variable/noto-sans-sc";
import "katex/dist/katex.min.css";
import "./globals.css";
const { version } = packageInfo;

export const metadata: Metadata = {
  title: { default: "Oh My Paper · 试卷工作台", template: "%s · Oh My Paper" },
  description: "上传试卷并解析为结构化题目。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main">
          跳转到主要内容
        </a>
        <Providers>{children}</Providers>
        <small className="site-version" aria-label={`网站版本 ${version}`}>
          v{version}
        </small>
      </body>
    </html>
  );
}
