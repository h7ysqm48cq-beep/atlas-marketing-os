import { AppLayout } from "@/components/AppLayout";
import { BrandCopilot } from "@/components/BrandCopilot";
import { AtlasWorkspaceProvider } from "@/components/ai-workspace-context";

export default function CopilotPage() {
  return (
    <AppLayout>
      <AtlasWorkspaceProvider>
        <BrandCopilot />
      </AtlasWorkspaceProvider>
    </AppLayout>
  );
}
