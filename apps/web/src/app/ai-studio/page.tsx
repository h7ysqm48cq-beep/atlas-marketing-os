import { AppLayout } from "@/components/AppLayout";
import { AiStudio } from "@/components/AiStudio";
import { AtlasWorkspaceProvider } from "@/components/ai-workspace-context";
import { AiRuntimeSettings } from "@/components/settings/AiRuntimeSettings";

export default function AiStudioPage() {
  return (
    <AppLayout>
      <AtlasWorkspaceProvider>
        <AiStudio />
        <AiRuntimeSettings section="studio" />
      </AtlasWorkspaceProvider>
    </AppLayout>
  );
}
