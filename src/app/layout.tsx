import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * Latin only, on purpose. Inter supplies the figures — which are the loudest
 * thing on the screen — while Hangul falls through to the platform font.
 * Self-hosted by next/font, so no request leaves the page at runtime.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "오늘 얼마 먹어도 돼?",
  description: "먹은 걸 말하면 오늘 얼마나 더 먹을 수 있는지 바로 알려줍니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f4f1",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={inter.variable}>
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
