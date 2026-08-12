import { Suspense } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ImageBrandEditor } from "@/components/ImageBrandEditor";

export default function ImageEditorPage() {
  return (
    <AppLayout>
      <Suspense
        fallback={
          <div
            style={{
              minHeight: "60vh",
              display: "grid",
              placeItems: "center",
            }}
          >
            Loading Image Editor...
          </div>
        }
      >
        <ImageBrandEditor />
      </Suspense>
    </AppLayout>
  );
}
