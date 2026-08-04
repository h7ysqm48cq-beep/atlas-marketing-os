import { AppLayout } from "@/components/AppLayout";
import { BrowserAccountsManager } from "@/components/automation/BrowserAccountsManager";

type BrowserAccountsPageProps = {
  searchParams: Promise<{
    channelId?: string;
  }>;
};

export default async function BrowserAccountsPage({
  searchParams,
}: BrowserAccountsPageProps) {
  const params =
    await searchParams;

  return (
    <AppLayout>
      <BrowserAccountsManager
        requestedChannelId={
          params.channelId || null
        }
      />
    </AppLayout>
  );
}
