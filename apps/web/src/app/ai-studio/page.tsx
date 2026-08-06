import { AiStudioMobileShell } from "@/components/AiStudioMobileShell";
import { AppLayout } from "@/components/AppLayout";
import { ImageEditorV2 } from "@/components/ImageEditorV2";

export default function AiStudioPage() {
  return (
    <AppLayout>
      <AiStudioMobileShell />
      <ImageEditorV2 />
    </AppLayout>
  );
}
