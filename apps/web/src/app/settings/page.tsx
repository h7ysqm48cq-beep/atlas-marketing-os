import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { WorkspaceSettings } from "@/components/settings/WorkspaceSettings";

export default function SettingsPage() {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />

        <div className="page-content">
          <WorkspaceSettings />
        </div>
      </main>
    </div>
  );
}
