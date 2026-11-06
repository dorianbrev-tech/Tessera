import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tessera — AI website recreation & generation", template: "%s · Tessera" },
  description: "Analyse any website, recreate it with high visual fidelity, or combine several references into a new site — then edit it with AI or code.",
};

export const viewport: Viewport = { themeColor: "#08080a", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen text-[13px] leading-5">{children}</body>
    </html>
  );
}
