const EXACT_ARTIFACT_DIRECTORIES = new Set([
  ".atlas",
  ".atlas-backups",
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
]);


const HIDDEN_TIMESTAMPED_BACKUP_DIRECTORY =
  /^\..+-backup-\d{8}(?:-\d{6})?$/u;


export function isEngineeringArtifactDirectory(
  name: string,
): boolean {
  return (
    EXACT_ARTIFACT_DIRECTORIES.has(name) ||
    HIDDEN_TIMESTAMPED_BACKUP_DIRECTORY.test(name)
  );
}


export function isEngineeringArtifactPath(
  filePath: string,
): boolean {
  return filePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .some(isEngineeringArtifactDirectory);
}
