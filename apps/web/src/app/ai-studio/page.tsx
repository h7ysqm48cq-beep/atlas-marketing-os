import { AppLayout } from "@/components/AppLayout";
import { AtlasAiWorkspace } from "@/components/AtlasAiWorkspace";
import { AtlasWorkspaceProvider } from "@/components/ai-workspace-context";

export default function AiStudioPage() {
  return (
    <AppLayout>
      <AtlasWorkspaceProvider>
        <AtlasAiWorkspace />
      </AtlasWorkspaceProvider>
    </AppLayout>
  );
}
