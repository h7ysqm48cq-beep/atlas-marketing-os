import path from 'node:path';

function canonicalRepositoryPath(value: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\\')) {
    throw new Error(`invalid_changed_path:${value}`);
  }

  const normalized = path.posix.normalize(value);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    normalized !== value
  ) {
    throw new Error(`invalid_changed_path:${value}`);
  }

  return normalized;
}

function canonicalList(values: string[]): string[] {
  return [...new Set(values.map(canonicalRepositoryPath))].sort();
}

export function parseGitStatusPorcelainZ(input: string): string[] {
  if (!input) return [];
  const records = input.split('\0');
  const changed: string[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4) {
      throw new Error('git_status_malformed');
    }

    const status = record.slice(0, 2);
    const firstPath = record.slice(3);
    const renamedOrCopied = status.includes('R') || status.includes('C');
    if (renamedOrCopied) {
      const destination = records[index + 1];
      if (!destination) throw new Error('git_status_rename_malformed');
      changed.push(canonicalRepositoryPath(destination));
      index += 1;
      continue;
    }

    changed.push(canonicalRepositoryPath(firstPath));
  }

  return [...new Set(changed)];
}

export class ExactScopeGuard {
  assertImplementationScope(changed: string[], allowed: string[]): void {
    const allowedSet = new Set(canonicalList(allowed));
    for (const changedPath of canonicalList(changed)) {
      if (!allowedSet.has(changedPath)) {
        throw new Error(`scope_drift:${changedPath}`);
      }
    }
  }

  assertVerificationNoDrift(before: string[], after: string[]): void {
    const beforeCanonical = canonicalList(before);
    const afterCanonical = canonicalList(after);
    if (
      beforeCanonical.length !== afterCanonical.length ||
      beforeCanonical.some((value, index) => value !== afterCanonical[index])
    ) {
      throw new Error('verification_git_drift');
    }
  }
}
