import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { PreferencesControls } from "@/components/preferences";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />
        <PreferencesControls />

        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
