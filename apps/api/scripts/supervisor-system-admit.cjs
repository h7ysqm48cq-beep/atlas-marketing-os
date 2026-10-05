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

function normalizedVerificationAdmission(input) {
  return {
    admissionId:
      String(input.admissionId || '').trim().toLowerCase(),
    task: input.task,
    candidateBaseSha:
      String(input.candidateBaseSha || '').trim().toLowerCase(),
    candidateHeadSha:
      String(input.candidateHeadSha || '').trim().toLowerCase(),
    productionBaselineSha:
      String(input.productionBaselineSha || '')
        .trim()
        .toLowerCase(),
    targetBranch:
      input.targetBranch || 'production/atlas',
    changedPaths: input.changedPaths,
  };
}

function digest(value) {
  return createHash('sha256')
    .update(canonicalize(value), 'utf8')
    .digest('hex');
}

function admissionDigest(input) {
  return digest(normalizedAdmission(input));
}

function verificationAdmissionDigest(input) {
  return digest(normalizedVerificationAdmission(input));
}

function signSystemAssertion(
  normalized,
  purpose,
  assertionDigest,
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

  const claims = {
    iss: ISSUER,
    sub: SUBJECT,
    aud: AUDIENCE,
    actorType: 'EXECUTIVE_SUPERVISOR',
    tokenType: 'SYSTEM_ASSERTION',
    purpose,
    iat: now.toISOString(),
    exp: new Date(now.getTime() + ttlMs).toISOString(),
    jti: randomUUID(),
    claimEpoch: 0,
    admissionId: normalized.admissionId,
    admissionDigest: assertionDigest,
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

function signAdmissionAssertion(input, options) {
  const normalized = normalizedAdmission(input);
  return signSystemAssertion(
    normalized,
    'ADMISSION',
    admissionDigest(normalized),
    options,
  );
}

function signVerificationAdmissionAssertion(
  input,
  options,
) {
  const normalized =
    normalizedVerificationAdmission(input);
  return signSystemAssertion(
    normalized,
    'VERIFICATION_COORDINATION',
    verificationAdmissionDigest(normalized),
    options,
  );
}

async function readInput() {
  const verificationFromEnv =
    process.env
      .ATLAS_SUPERVISOR_SYSTEM_VERIFICATION_ADMISSION_JSON;
  const admissionFromEnv =
    process.env.ATLAS_SUPERVISOR_SYSTEM_ADMISSION_JSON;

  if (verificationFromEnv && admissionFromEnv) {
    throw new Error(
      'supervisor_system_admission_input_conflict',
    );
  }
  if (verificationFromEnv) {
    return {
      kind: 'verification',
      input: JSON.parse(verificationFromEnv),
    };
  }
  if (admissionFromEnv) {
    return {
      kind: 'admission',
      input: JSON.parse(admissionFromEnv),
    };
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
  return {
    kind:
      process.env.ATLAS_SUPERVISOR_SYSTEM_PURPOSE ===
      'VERIFICATION_COORDINATION'
        ? 'verification'
        : 'admission',
    input: JSON.parse(raw),
  };
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
  const request = await readInput();
  const input = request.input;
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

  const verification =
    request.kind === 'verification';
  const token =
    verification
      ? signVerificationAdmissionAssertion(input, {
          kid,
          privateKeyPem,
        })
      : signAdmissionAssertion(input, {
          kid,
          privateKeyPem,
        });
  const route =
    verification
      ? 'verification-admissions'
      : 'admissions';

  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/engineering/supervisor/system/${route}`,
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
      `supervisor_system_admission_failed status=${failure.status} code=${failure.code}
`,
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
    })}
`,
  );
}

module.exports = {
  admissionDigest,
  canonicalize,
  normalizedAdmission,
  normalizedVerificationAdmission,
  signAdmissionAssertion,
  signVerificationAdmissionAssertion,
  verificationAdmissionDigest,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `supervisor_system_admission_failed code=${
        error instanceof Error
          ? error.message
          : 'unknown_error'
      }
`,
    );
    process.exitCode = 1;
  });
}
