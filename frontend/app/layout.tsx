import type { Metadata } from "next";
import { Onest } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { AppProvider } from "@/lib/app-context";
import "./globals.css";

const onest = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-onest", display: "swap" });

export const metadata: Metadata = {
  title: "AqylRoute AI",
  description: "Межведомственный маршрут помощи семье: интервью, единый план, контроль сроков",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={onest.variable}>
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
