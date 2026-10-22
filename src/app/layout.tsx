import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "INU 벽돌깨기",
  description: "인천대학교 벽돌깨기 게임",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased font-sans">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
