import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { AutomationDashboard } from "@/components/automation/AutomationDashboard";

export default function AutomationPage() {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />

        <div className="page-content">
          <AutomationDashboard />
        </div>
      </main>
    </div>
  );
}
