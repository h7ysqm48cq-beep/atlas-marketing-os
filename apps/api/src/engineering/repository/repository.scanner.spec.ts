import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  RepositoryScanner,
} from "./repository.scanner";


describe("RepositoryScanner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(
      join(
        tmpdir(),
        "atlas-repository-scanner-",
      ),
    );
  });

  afterEach(async () => {
    await rm(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  });

  it("excludes tracked Copilot backup artifacts from repository context", async () => {
    const sourceDir = join(
      root,
      "apps",
      "web",
      "src",
    );

    const attachmentStateBackup = join(
      root,
      ".copilot-attachment-state-backup-20260729-042759",
    );

    const attachmentUiBackup = join(
      root,
      ".copilot-attachment-ui-v1-backup-20260729-042211",
    );

    await Promise.all([
      mkdir(sourceDir, { recursive: true }),
      mkdir(attachmentStateBackup, { recursive: true }),
      mkdir(attachmentUiBackup, { recursive: true }),
    ]);

    const sourceFile = join(
      sourceDir,
      "EngineeringCopilot.tsx",
    );

    await Promise.all([
      writeFile(
        sourceFile,
        "export const live = true;\n",
      ),
      writeFile(
        join(
          attachmentStateBackup,
          "BrandCopilot.tsx",
        ),
        "export const stale = true;\n",
      ),
      writeFile(
        join(
          attachmentUiBackup,
          "BrandCopilot.module.css",
        ),
        ".stale {}\n",
      ),
    ]);

    const files = await new RepositoryScanner().scan(root);
    const paths = files.map((file) => file.path);

    expect(paths).toContain(sourceFile);
    expect(
      paths.some((path) =>
        path.includes(
          ".copilot-attachment-",
        ),
      ),
    ).toBe(false);
  });
});
