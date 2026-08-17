export async function saveRemoteFile({
  url,
  filename,
  mimeType,
  title,
}: {
  url: string;
  filename: string;
  mimeType?: string | null;
  title?: string;
}): Promise<"shared" | "downloaded"> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to load file.");

  const blob = await response.blob();
  const file = new File([blob], filename, {
    type: mimeType || blob.type || "application/octet-stream",
  });
  const shareData = { files: [file], title: title || filename };

  if (navigator.share && navigator.canShare?.(shareData)) {
    await navigator.share(shareData);
    return "shared";
  }

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return "downloaded";
}
