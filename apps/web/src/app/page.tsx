import { DashboardOverview } from "@/components/DashboardOverview";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export default function Home() {
  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-panel">
        <Header />

        <div className="page-content">
          <DashboardOverview />
        </div>
      </main>
    </div>
  );
}
