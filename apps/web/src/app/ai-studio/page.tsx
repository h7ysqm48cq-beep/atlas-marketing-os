import { AppLayout } from "@/components/AppLayout";
import { AiStudio } from "@/components/AiStudio";
import { AtlasWorkspaceProvider } from "@/components/ai-workspace-context";

export default function AiStudioPage() {
  return (
    <AppLayout>
      <AtlasWorkspaceProvider>
        <AiStudio />
      </AtlasWorkspaceProvider>
    </AppLayout>
  );
}
