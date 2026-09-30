const { createHash } = require('node:crypto');
const {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join, relative, sep } = require('node:path');
const { spawnSync } = require('node:child_process');

const apiRoot = join(__dirname, '..');
const repoRoot = join(apiRoot, '..', '..');
const generatedRoot = join(apiRoot, 'src', 'generated', 'prisma');

const EXPECTED_PRISMA_VERSION = '7.9.1';
const DUMMY_DATABASE_URL =
  'postgresql://postgres:unused@127.0.0.1:59999/unused';

function fail(message) {
  console.error(`PRISMA_GENERATED_CLIENT_REPRO_FAIL: ${message}`);
  process.exit(1);
}

function walkFiles(root) {
  if (!existsSync(root)) {
    fail(`generated directory missing: ${root}`);
  }

  const result = [];

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolute = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        result.push(absolute);
      }
    }
  }

  walk(root);
  return result;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function snapshot(root) {
  const files = new Map();

  for (const absolute of walkFiles(root)) {
    const name = relative(root, absolute).split(sep).join('/');
    files.set(name, sha256(readFileSync(absolute)));
  }

  return files;
}

function manifestHash(snapshotMap) {
  const hash = createHash('sha256');

  for (const [name, digest] of [...snapshotMap.entries()].sort()) {
    hash.update(name);
    hash.update('\0');
    hash.update(digest);
    hash.update('\n');
  }

  return hash.digest('hex');
}

function normalizeChangedGeneratedWhitespace(root, before) {
  for (const [name, digest] of snapshot(root)) {
    if (before.get(name) === digest) {
      continue;
    }

    const absolute = join(root, ...name.split('/'));
    const source = readFileSync(absolute, 'utf8');
    const normalized = source.replace(/[ \t]+$/gm, '');

    if (normalized !== source) {
      writeFileSync(absolute, normalized);
    }
  }
}

function compare(before, after) {
  const added = [];
  const removed = [];
  const changed = [];

  for (const name of after.keys()) {
    if (!before.has(name)) {
      added.push(name);
    } else if (before.get(name) !== after.get(name)) {
      changed.push(name);
    }
  }

  for (const name of before.keys()) {
    if (!after.has(name)) {
      removed.push(name);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}

const prismaPackage = require(join(
  repoRoot,
  'node_modules',
  'prisma',
  'package.json',
));

if (prismaPackage.version !== EXPECTED_PRISMA_VERSION) {
  fail(
    `expected root Prisma CLI ${EXPECTED_PRISMA_VERSION}, ` +
      `found ${prismaPackage.version}`,
  );
}

const before = snapshot(generatedRoot);
const beforeHash = manifestHash(before);

const prismaBin = join(repoRoot, 'node_modules', '.bin', 'prisma');

const generation = spawnSync(
  prismaBin,
  ['generate', '--config', '../../prisma.config.ts'],
  {
    cwd: apiRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL || DUMMY_DATABASE_URL,
    },
  },
);

if (generation.error) {
  fail(`unable to execute Prisma CLI: ${generation.error.message}`);
}

if (generation.status !== 0) {
  fail(`prisma generate exited ${generation.status}`);
}

normalizeChangedGeneratedWhitespace(generatedRoot, before);

const after = snapshot(generatedRoot);
const afterHash = manifestHash(after);
const delta = compare(before, after);

if (
  delta.added.length ||
  delta.removed.length ||
  delta.changed.length
) {
  console.error('Prisma generated client drift detected.');

  for (const name of delta.added) {
    console.error(`A ${name}`);
  }

  for (const name of delta.removed) {
    console.error(`D ${name}`);
  }

  for (const name of delta.changed) {
    console.error(`M ${name}`);
  }

  console.error(`beforeManifest=${beforeHash}`);
  console.error(`afterManifest=${afterHash}`);

  process.exit(1);
}

console.log('Prisma generated client reproducibility guard passed.');
console.log(`prismaVersion=${prismaPackage.version}`);
console.log(`generatedFiles=${after.size}`);
console.log(`manifestSHA256=${afterHash}`);
