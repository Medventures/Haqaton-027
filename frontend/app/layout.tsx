import type { Metadata } from "next";
import { AppProvider } from "@/lib/app-context";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "AqylRoute AI",
  description: "Межведомственный маршрут помощи семье: интервью, Case Plan, контроль сроков",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppProvider>
          <Header />
          <main className="container">{children}</main>
          <footer className="footer container">
            Все данные синтетические. Система не ставит диагнозы и не даёт медицинских рекомендаций.
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
