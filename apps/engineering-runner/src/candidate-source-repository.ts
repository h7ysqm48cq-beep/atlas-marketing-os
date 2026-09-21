import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const CANONICAL_CANDIDATE_REMOTE =
  "https://github.com/h7ysqm48cq-beep/atlas-marketing-os.git";
const PRODUCTION_SOURCE_REF = "refs/atlas/source/production";

function dangerousTransportConfig(key: string): boolean {
  const value = key.trim().toLowerCase();
  return (
    value.startsWith("credential.") ||
    value.startsWith("http.") ||
    value.startsWith("https.") ||
    value.startsWith("include.") ||
    value.startsWith("includeif.") ||
    value.startsWith("filter.") ||
    value === "core.sshcommand" ||
    value === "core.gitproxy" ||
    value === "core.fsmonitor" ||
    value === "core.attributesfile" ||
    value === "core.excludesfile" ||
    value === "diff.external" ||
    (value.startsWith("diff.") && value.endsWith(".command")) ||
    (value.startsWith("merge.") && value.endsWith(".driver")) ||
    value === "gpg.program" ||
    value === "commit.gpgsign" ||
    value.startsWith("protocol.") ||
    (value.startsWith("url.") &&
      (value.endsWith(".insteadof") || value.endsWith(".pushinsteadof")))
  );
}
export interface CandidateSourceRepositoryOptions {
  repositoryRoot: string;
  remote: string;
  sourceToken?: string;
  environment?: NodeJS.ProcessEnv;
}

export class CandidateSourceRepository {
  private readonly repositoryRoot: string;
  private readonly remote: string;
  private readonly sourceToken?: string;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: CandidateSourceRepositoryOptions) {
    this.repositoryRoot = options.repositoryRoot;
    this.remote = options.remote;
    this.sourceToken = options.sourceToken?.trim() || undefined;

    const networked = /^[a-z][a-z0-9+.-]*:\/\//i.test(this.remote);
    if (networked && this.remote !== CANONICAL_CANDIDATE_REMOTE) {
      throw new Error("candidate_source_remote_not_canonical");
    }
    const source = options.environment ?? process.env;
    this.environment = {
      ...Object.fromEntries(
        ["PATH", "TMPDIR"].flatMap((key) =>
          source[key] === undefined ? [] : [[key, source[key]]],
        ),
      ),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
    };
  }

  private gitEnvironment(transport = false): NodeJS.ProcessEnv {
    if (!transport || !this.sourceToken) {
      return { ...this.environment };
    }
    const authorization = Buffer.from(
      `x-access-token:${this.sourceToken}`,
      "utf8",
    ).toString("base64");
    return {
      ...this.environment,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${authorization}`,
    };
  }
  private async gitRaw(
    cwd: string,
    args: string[],
    transport = false,
  ): Promise<string> {
    const safeArgs = [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      ...args,
    ];
    const { stdout } = await execFileAsync("git", safeArgs, {
      cwd,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: this.gitEnvironment(transport),
    });
    return stdout;
  }

  private async ensureRepository(): Promise<void> {
    try {
      await lstat(this.repositoryRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      await mkdir(path.dirname(this.repositoryRoot), { recursive: true });
      await this.gitRaw(path.dirname(this.repositoryRoot), [
        "init",
        "--bare",
        this.repositoryRoot,
      ]);
    }
    let isBare = "";
    try {
      isBare = (
        await this.gitRaw(this.repositoryRoot, [
          "rev-parse",
          "--is-bare-repository",
        ])
      ).trim();
    } catch {
      throw new Error("candidate_source_repository_invalid");
    }
    if (isBare !== "true") {
      throw new Error("candidate_source_repository_not_bare");
    }
  }

  private async assertTransportConfigSafe(): Promise<void> {
    const raw = await this.gitRaw(this.repositoryRoot, [
      "config",
      "--local",
      "--list",
      "--name-only",
      "-z",
    ]);
    if (raw.split("\0").filter(Boolean).some(dangerousTransportConfig)) {
      throw new Error("candidate_source_transport_config_unsafe");
    }
  }
  async refresh(): Promise<void> {
    await this.ensureRepository();
    await this.assertTransportConfigSafe();
    await this.gitRaw(
      this.repositoryRoot,
      [
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        this.remote,
        `refs/heads/production/atlas:${PRODUCTION_SOURCE_REF}`,
      ],
      true,
    );
  }

  async ensureProductionHead(expectedSha: string): Promise<void> {
    if (!FULL_GIT_SHA.test(expectedSha)) {
      throw new Error('existing_candidate_production_baseline_invalid');
    }
    await this.refresh();
    const remoteHead = (await this.gitRaw(this.repositoryRoot, [
      'rev-parse', '--verify', PRODUCTION_SOURCE_REF,
    ])).trim().toLowerCase();
    if (remoteHead !== expectedSha.toLowerCase()) {
      throw new Error('existing_candidate_production_baseline_drift');
    }
  }

  async ensureExistingCandidate(baseSha: string, headSha: string): Promise<void> {
    if (!FULL_GIT_SHA.test(baseSha) || !FULL_GIT_SHA.test(headSha) ||
        baseSha.toLowerCase() === headSha.toLowerCase()) {
      throw new Error('existing_candidate_identity_invalid');
    }
    // Source and base must be production-ancestry verified, while the
    // unmerged exact head may not yet be reachable from production.
    await this.ensureBase(baseSha);
    await this.assertTransportConfigSafe();
    try {
      await this.gitRaw(this.repositoryRoot, [
        'fetch', '--no-tags', '--no-recurse-submodules',
        this.remote, headSha.toLowerCase(),
      ], true);
      const fetched = (await this.gitRaw(this.repositoryRoot, [
        'rev-parse', '--verify', 'FETCH_HEAD^{commit}',
      ])).trim().toLowerCase();
      if (fetched !== headSha.toLowerCase()) {
        throw new Error('existing_candidate_fetch_head_mismatch');
      }
      await this.gitRaw(this.repositoryRoot, [
        'merge-base', '--is-ancestor', baseSha.toLowerCase(), fetched,
      ]);
    } catch {
      throw new Error('existing_candidate_source_identity_unverified');
    }
  }

  async ensureBase(frozenBaseSha: string): Promise<void> {
    const baseSha = frozenBaseSha.trim().toLowerCase();
    if (!FULL_GIT_SHA.test(baseSha)) {
      throw new Error("candidate_source_base_invalid");
    }

    await this.refresh();

    try {
      const resolved = (
        await this.gitRaw(this.repositoryRoot, [
          "rev-parse",
          "--verify",
          `${baseSha}^{commit}`,
        ])
      )
        .trim()
        .toLowerCase();
      if (resolved !== baseSha) throw new Error("mismatch");
    } catch {
      throw new Error("candidate_source_base_unavailable");
    }
    try {
      await this.gitRaw(this.repositoryRoot, [
        "merge-base",
        "--is-ancestor",
        baseSha,
        PRODUCTION_SOURCE_REF,
      ]);
    } catch {
      throw new Error("candidate_source_base_not_production_ancestor");
    }
  }
}
