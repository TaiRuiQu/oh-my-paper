import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Oh My Paper · 试卷工作台", template: "%s · Oh My Paper" },
  description: "试卷解析、批改与错题练习工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main">
          跳转到主要内容
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
