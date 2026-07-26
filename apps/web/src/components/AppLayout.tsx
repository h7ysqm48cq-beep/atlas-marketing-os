import type { ReactNode } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

type AppLayoutProps = {
  children: ReactNode;
};

export function AppLayout({
  children,
}: AppLayoutProps) {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />

        <div className="page-content">
          {children}
        </div>
      </main>
    </div>
  );
}
