import { AppLayout } from "@/components/AppLayout";
import { BrandCopilot } from "@/components/BrandCopilot";
import { AtlasWorkspaceProvider } from "@/components/ai-workspace-context";
import { AiRuntimeSettings } from "@/components/settings/AiRuntimeSettings";

export default function CopilotPage() {
  return (
    <AppLayout>
      <AtlasWorkspaceProvider>
        <BrandCopilot />
        <AiRuntimeSettings section="copilot" />
      </AtlasWorkspaceProvider>
    </AppLayout>
  );
}
