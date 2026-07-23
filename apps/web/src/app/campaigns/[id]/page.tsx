import { CampaignPlanner } from "@/components/CampaignPlanner";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Header />
        <div className="page-content">
          <CampaignPlanner campaignId={id} />
        </div>
      </main>
    </div>
  );
}
