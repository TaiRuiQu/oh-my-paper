import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import packageInfo from "../../package.json";
import "@fontsource-variable/geist";
import "@fontsource-variable/noto-sans-sc";
import "katex/dist/katex.min.css";
import "./globals.css";
const { version } = packageInfo;
const commit = process.env.NEXT_PUBLIC_APP_COMMIT;

export const metadata: Metadata = {
  title: { default: "Oh My Paper · 教学工作台", template: "%s · Oh My Paper" },
  description: "从题库、组卷和考试阅卷，到成绩与学情分析的一站式教学工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main">
          跳转到主要内容
        </a>
        <Providers>{children}</Providers>
        <small
          role="contentinfo"
          className="site-version"
          title={`网站版本 ${version}${commit ? ` · Git ${commit}` : ""}`}
          data-commit={commit || undefined}
        >
          v{version}
          {commit ? ` · ${commit.slice(0, 6)}` : ""}
        </small>
      </body>
    </html>
  );
}
