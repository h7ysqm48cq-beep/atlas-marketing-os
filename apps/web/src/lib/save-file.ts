type SaveFileResult = "shared" | "downloaded";

function safeFilename(filename: string) {
  return filename.replace(/[\\/:*?"<>|]+/g, "-").trim() || "atlas-image.png";
}

export async function saveRemoteFile(
  url: string,
  filename: string,
): Promise<SaveFileResult> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Unable to download file.");
  }

  const blob = await response.blob();
  const cleanFilename = safeFilename(filename);
  const file = new File([blob], cleanFilename, {
    type: blob.type || "application/octet-stream",
  });

  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({
      files: [file],
      title: cleanFilename,
    });
    return "shared";
  }

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = blobUrl;
  link.download = cleanFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);

  return "downloaded";
}
