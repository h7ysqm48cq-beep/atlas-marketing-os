import { AppLayout } from "@/components/AppLayout";
import { BrowserAccountsManagerV2 } from "@/components/automation/BrowserAccountsManagerV2";

type BrowserAccountsPageProps = {
  searchParams: Promise<{
    accountId?: string;
    channelId?: string;
    viewer?: string;
  }>;
};

export default async function BrowserAccountsPage({
  searchParams,
}: BrowserAccountsPageProps) {
  const params =
    await searchParams;

  return (
    <AppLayout>
      <BrowserAccountsManagerV2
        requestedAccountId={
          params.accountId ||
          null
        }
        requestedViewerOpen={params.viewer === "1"}
      />
    </AppLayout>
  );
}
