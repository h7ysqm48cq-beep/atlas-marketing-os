import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { AiUsageDashboard } from "@/components/ai-usage/AiUsageDashboard";

export default function AiUsagePage() {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />

        <div className="page-content">
          <AiUsageDashboard />
        </div>
      </main>
    </div>
  );
}
