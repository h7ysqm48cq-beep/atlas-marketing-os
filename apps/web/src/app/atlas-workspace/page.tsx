import { AtlasAiWorkspace } from "@/components/AtlasAiWorkspace";
import { AtlasWorkspaceProvider } from "@/components/ai-workspace-context";

export default function AtlasWorkspacePage() {
  return (
    <AtlasWorkspaceProvider>
      <AtlasAiWorkspace />
    </AtlasWorkspaceProvider>
  );
}
