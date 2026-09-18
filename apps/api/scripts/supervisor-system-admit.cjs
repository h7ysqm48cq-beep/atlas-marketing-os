#!/usr/bin/env node
'use strict';

const {
  createHash,
  createPrivateKey,
  randomUUID,
  sign: cryptoSign,
} = require('node:crypto');

const ISSUER = 'atlas.supervisor.control-plane';
const SUBJECT = 'atlas:executive-supervisor';
const AUDIENCE = 'atlas:supervisor.gateway';

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalize(value[key])}`,
    )
    .join(',')}}`;
}

function encode(value) {
  return Buffer.from(canonicalize(value), 'utf8').toString(
    'base64url',
  );
}

function normalizedAdmission(input) {
  return {
    admissionId:
      String(input.admissionId || '').trim().toLowerCase(),
    task: input.task,
    frozenBaseSha:
      String(input.frozenBaseSha || '')
        .trim()
        .toLowerCase() || undefined,
  };
}

function admissionDigest(input) {
  return createHash('sha256')
    .update(
      canonicalize(normalizedAdmission(input)),
      'utf8',
    )
    .digest('hex');
}

function signAdmissionAssertion(
  input,
  {
    kid,
    privateKeyPem,
    now = new Date(),
    ttlMs = 60_000,
  },
) {
  if (!kid || !privateKeyPem) {
    throw new Error(
      'supervisor_system_signing_material_required',
    );
  }

  const normalized = normalizedAdmission(input);
  const claims = {
    iss: ISSUER,
    sub: SUBJECT,
    aud: AUDIENCE,
    actorType: 'EXECUTIVE_SUPERVISOR',
    tokenType: 'SYSTEM_ASSERTION',
    purpose: 'ADMISSION',
    iat: now.toISOString(),
    exp: new Date(now.getTime() + ttlMs).toISOString(),
    jti: randomUUID(),
    claimEpoch: 0,
    admissionId: normalized.admissionId,
    admissionDigest: admissionDigest(normalized),
  };
  const header = {
    typ: 'ATLAS_AUTHORITY',
    alg: 'EdDSA',
    kid,
  };
  const encodedHeader = encode(header);
  const encodedClaims = encode(claims);
  const signingInput =
    `${encodedHeader}.${encodedClaims}`;
  const signature = cryptoSign(
    null,
    Buffer.from(signingInput, 'utf8'),
    createPrivateKey(privateKeyPem),
  ).toString('base64url');

  return `${signingInput}.${signature}`;
}

async function readInput() {
  const fromEnv =
    process.env.ATLAS_SUPERVISOR_SYSTEM_ADMISSION_JSON;
  if (fromEnv) {
    return JSON.parse(fromEnv);
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    throw new Error(
      'supervisor_system_admission_input_required',
    );
  }
  return JSON.parse(raw);
}

function safeFailure(status, body) {
  const code =
    body && typeof body === 'object'
      ? body.code ||
        body.message ||
        body.error ||
        'unknown_error'
      : 'unknown_error';
  return {
    status,
    code:
      typeof code === 'string'
        ? code
        : 'unknown_error',
  };
}

async function main() {
  const input = await readInput();
  const baseUrl =
    process.env.ATLAS_SUPERVISOR_API_URL;
  const kid =
    process.env
      .ATLAS_SUPERVISOR_SUPERVISOR_SYSTEM_SIGNING_KID;
  const privateKeyPem =
    process.env
      .ATLAS_SUPERVISOR_SUPERVISOR_SYSTEM_SIGNING_PRIVATE_KEY;

  if (!baseUrl) {
    throw new Error(
      'atlas_supervisor_api_url_required',
    );
  }

  const token = signAdmissionAssertion(input, {
    kid,
    privateKeyPem,
  });
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/engineering/supervisor/system/admissions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const failure = safeFailure(
      response.status,
      body,
    );
    process.stderr.write(
      `supervisor_system_admission_failed status=${failure.status} code=${failure.code}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      admissionId: body.admissionId,
      taskId: body.taskId,
      taskStatus: body.taskStatus,
      executionId: body.executionId,
      executionStatus: body.executionStatus,
    })}\n`,
  );
}

module.exports = {
  admissionDigest,
  canonicalize,
  normalizedAdmission,
  signAdmissionAssertion,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `supervisor_system_admission_failed code=${
        error instanceof Error
          ? error.message
          : 'unknown_error'
      }\n`,
    );
    process.exitCode = 1;
  });
}
