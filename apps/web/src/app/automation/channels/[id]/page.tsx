import { AppLayout } from "@/components/AppLayout";
import { ChannelDetail } from "@/components/automation/ChannelDetail";

export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppLayout>
      <ChannelDetail channelId={id} />
    </AppLayout>
  );
}
