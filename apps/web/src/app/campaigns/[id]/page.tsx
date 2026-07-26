import { CampaignPlanner } from "@/components/CampaignPlanner";
import { AppLayout } from "@/components/AppLayout";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppLayout>
      <CampaignPlanner campaignId={id} />
    </AppLayout>
  );
}
