import { CampaignsPage } from "@/components/CampaignsPage";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export default function CampaignsRoute() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <CampaignsPage />
        </div>
      </main>
    </div>
  );
}
