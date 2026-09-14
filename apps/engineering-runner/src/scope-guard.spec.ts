import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('./scope-guard.ts')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

test('ExactScopeGuard accepts only exact allowed paths and rejects prefix expansion', async () => {
  const mod = await loadModule();
  const Guard = mod.ExactScopeGuard as
    | (new () => {
        assertImplementationScope(changed: string[], allowed: string[]): void;
      })
    | undefined;
  assert.ok(Guard, 'ExactScopeGuard must exist');
  const guard = new Guard();

  assert.doesNotThrow(() =>
    guard.assertImplementationScope(
      ['apps/api/src/exact.ts'],
      ['apps/api/src/exact.ts'],
    ),
  );
  assert.throws(
    () =>
      guard.assertImplementationScope(
        ['apps/api/src/exact.ts/child'],
        ['apps/api/src/exact.ts'],
      ),
    /scope_drift/,
  );
});

test('ExactScopeGuard fails closed on absolute and traversal paths', async () => {
  const mod = await loadModule();
  const Guard = mod.ExactScopeGuard as
    | (new () => {
        assertImplementationScope(changed: string[], allowed: string[]): void;
      })
    | undefined;
  assert.ok(Guard, 'ExactScopeGuard must exist');
  const guard = new Guard();

  assert.throws(
    () => guard.assertImplementationScope(['/tmp/secret'], ['/tmp/secret']),
    /invalid_changed_path/,
  );
  assert.throws(
    () => guard.assertImplementationScope(['../secret'], ['../secret']),
    /invalid_changed_path/,
  );
});

test('independent verification rejects any tracked git drift', async () => {
  const mod = await loadModule();
  const Guard = mod.ExactScopeGuard as
    | (new () => {
        assertVerificationNoDrift(before: string[], after: string[]): void;
      })
    | undefined;
  assert.ok(Guard, 'ExactScopeGuard must exist');
  const guard = new Guard();

  assert.doesNotThrow(() =>
    guard.assertVerificationNoDrift(
      ['apps/api/src/existing.ts'],
      ['apps/api/src/existing.ts'],
    ),
  );
  assert.throws(
    () =>
      guard.assertVerificationNoDrift(
        ['apps/api/src/existing.ts'],
        ['apps/api/src/existing.ts', 'apps/api/src/new.ts'],
      ),
    /verification_git_drift/,
  );
});

test('GitWorkspace is exported from scope-guard.ts for scope-owned workspace inspection', async () => {
  const mod = await loadModule();
  const Workspace = mod.GitWorkspace as
    | (new (cwd: string) => { listChangedFiles(): Promise<string[]> })
    | undefined;

  assert.ok(
    Workspace,
    'GitWorkspace must be exported from scope-guard.ts',
  );
  assert.throws(
    () => new Workspace(''),
    /workspace_cwd_required/,
  );
});

test('parseGitStatusPorcelainZ returns canonical changed paths including rename destination', async () => {
  const mod = await loadModule();
  const parse = mod.parseGitStatusPorcelainZ as
    | ((input: string) => string[])
    | undefined;
  assert.ok(parse, 'parseGitStatusPorcelainZ must exist');

  assert.deepEqual(
    parse(' M apps/a.ts\0?? apps/b.ts\0R  apps/old.ts\0apps/new.ts\0'),
    ['apps/a.ts', 'apps/b.ts', 'apps/new.ts'],
  );
});
