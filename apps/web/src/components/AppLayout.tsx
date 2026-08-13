import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { PwaMobileNav } from "@/components/PwaMobileNav";
import { PwaNavigationProgress } from "@/components/PwaNavigationProgress";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />

        <div className="page-content">{children}</div>
      </main>

      <PwaNavigationProgress />
      <PwaMobileNav />
    </div>
  );
}
