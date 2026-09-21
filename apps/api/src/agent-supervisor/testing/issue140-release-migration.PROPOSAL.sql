-- ISSUE #140 RELEASE-MIGRATION PROPOSAL. NOT AN AUTHORIZED PRISMA MIGRATION.
-- Do NOT move to prisma/migrations or execute against production without
-- separate Human Owner schema authorization and independent DBA/role review.
-- No separate runtime app/table-owner custody has been proven in production.
-- Existing Supervisor persistence and liveness migrations are prerequisites.
-- The append-only triggers are not a substitute for Ed25519 validation;
-- the service MUST verify actual claim/completion signatures and key custody.
-- This file is intentionally outside prisma/migrations to prevent automatic
-- deployment by migration tooling. Local/disposable verification ONLY.

-- BEGIN issue140-attestation-ledger.local.sql
-- ISSUE #140 LOCAL DISPOSABLE POC ONLY. Not a production migration.
-- Requires existing SupervisorTask, SupervisorExecution, liveness migrations.
-- Real deployment requires separate schema governance, role/custody review.
-- proofDigest is supplied by the application, NOT recomputed by PostgreSQL;
-- it MUST be independently verified against canonical signed claim bytes
-- before INSERT and again when reading under READY transaction locks.
-- Table owner/superuser can disable triggers: use separately held DB owner
-- and deploy credentials. App role must never have schema/owner privilege.
-- Physical append-only protection is NOT cryptographic authenticity.
CREATE TABLE "SupervisorActorClaimProof" (
  "executionId" TEXT PRIMARY KEY REFERENCES "SupervisorExecution"("id") ON DELETE RESTRICT,
  "taskId" TEXT NOT NULL REFERENCES "SupervisorTask"("id") ON DELETE RESTRICT,
  "claimEpoch" INTEGER NOT NULL CHECK ("claimEpoch" > 0),
  "claimNonce" TEXT NOT NULL UNIQUE CHECK (length("claimNonce") >= 8),
  "kid" TEXT NOT NULL CHECK (length("kid") > 0),
  "proof" JSONB NOT NULL CHECK (jsonb_typeof("proof") = 'object'),
  "proofDigest" TEXT NOT NULL CHECK ("proofDigest" ~ '^[0-9a-f]{64}$'),
  "insertedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("executionId", "claimEpoch"),
  UNIQUE ("executionId", "claimEpoch", "proofDigest")
);

CREATE TABLE "SupervisorActorCompletionProof" (
  "executionId" TEXT PRIMARY KEY
    REFERENCES "SupervisorActorClaimProof"("executionId") ON DELETE RESTRICT,
  "taskId" TEXT NOT NULL REFERENCES "SupervisorTask"("id") ON DELETE RESTRICT,
  "claimEpoch" INTEGER NOT NULL,
  "claimProofDigest" TEXT NOT NULL CHECK ("claimProofDigest" ~ '^[0-9a-f]{64}$'),
  "kid" TEXT NOT NULL CHECK (length("kid") > 0),
  "proof" JSONB NOT NULL CHECK (jsonb_typeof("proof") = 'object'),
  "insertedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY ("executionId", "claimEpoch", "claimProofDigest")
    REFERENCES "SupervisorActorClaimProof"("executionId", "claimEpoch", "proofDigest")
    ON DELETE RESTRICT
);

CREATE FUNCTION issue140_forbid_proof_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issue140_attestation_append_only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER issue140_claim_append_only
BEFORE UPDATE OR DELETE ON "SupervisorActorClaimProof"
FOR EACH ROW EXECUTE FUNCTION issue140_forbid_proof_rewrite();

CREATE TRIGGER issue140_completion_append_only
BEFORE UPDATE OR DELETE ON "SupervisorActorCompletionProof"
FOR EACH ROW EXECUTE FUNCTION issue140_forbid_proof_rewrite();

CREATE FUNCTION issue140_enforce_claim_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution_row "SupervisorExecution"%ROWTYPE;
BEGIN
  SELECT * INTO execution_row FROM "SupervisorExecution"
    WHERE "id" = NEW."executionId" FOR UPDATE;
  IF NOT FOUND OR execution_row."taskId" IS DISTINCT FROM NEW."taskId"
      OR execution_row."status" IS DISTINCT FROM 'RUNNING'
      OR execution_row."claimEpoch" IS DISTINCT FROM NEW."claimEpoch"
      OR execution_row."assignment"->'bootstrapActor'->>'kid' IS DISTINCT FROM NEW."kid"
      OR execution_row."assignment"->'bootstrapActor'->>'claimNonce' IS DISTINCT FROM NEW."claimNonce"
      OR execution_row."assignment"->>'executionId' IS DISTINCT FROM NEW."executionId"
      OR execution_row."assignment"->>'taskId' IS DISTINCT FROM NEW."taskId"
      OR (execution_row."assignment"->>'claimEpoch')::integer IS DISTINCT FROM NEW."claimEpoch"
  THEN
    RAISE EXCEPTION 'issue140_claim_not_atomic_or_mismatched'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue140_claim_insert_guard
BEFORE INSERT ON "SupervisorActorClaimProof"
FOR EACH ROW EXECUTE FUNCTION issue140_enforce_claim_insert();

CREATE FUNCTION issue140_enforce_completion_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution_row "SupervisorExecution"%ROWTYPE;
DECLARE claim_row "SupervisorActorClaimProof"%ROWTYPE;
BEGIN
  -- Proof is append-only and app role has SELECT/INSERT, no UPDATE.
  -- Execution row is locked below; claim cannot be rewritten by app.
  SELECT * INTO claim_row FROM "SupervisorActorClaimProof"
    WHERE "executionId" = NEW."executionId";
  SELECT * INTO execution_row FROM "SupervisorExecution"
    WHERE "id" = NEW."executionId" FOR UPDATE;
  IF claim_row."executionId" IS NULL
      OR execution_row."id" IS NULL
      OR claim_row."taskId" IS DISTINCT FROM NEW."taskId"
      OR execution_row."taskId" IS DISTINCT FROM NEW."taskId"
      OR execution_row."status" IS DISTINCT FROM 'COMPLETED'
      OR execution_row."result" IS NULL
      OR claim_row."kid" IS DISTINCT FROM NEW."kid"
      OR claim_row."claimEpoch" IS DISTINCT FROM NEW."claimEpoch"
      OR execution_row."claimEpoch" IS DISTINCT FROM NEW."claimEpoch"
      OR NEW."claimProofDigest" IS DISTINCT FROM claim_row."proofDigest"
  THEN
    RAISE EXCEPTION 'issue140_completion_without_matching_claim'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issue140_completion_insert_guard
BEFORE INSERT ON "SupervisorActorCompletionProof"
FOR EACH ROW EXECUTE FUNCTION issue140_enforce_completion_insert();

-- Application role should have SELECT/INSERT only, never UPDATE/DELETE/TRUNCATE.
-- Table owner, schema owner, and DB administrator credentials require separate custody.

-- END issue140-attestation-ledger.local.sql

-- BEGIN issue140-preclaim-challenge.local.sql
-- ISSUE #140 LOCAL DISPOSABLE SQL POC ONLY; NOT A PRODUCTION MIGRATION.
-- Apply after original Supervisor migrations and attestation-ledger.local.sql.
-- Server must authenticate the bearer AND VERIFY the Ed25519 PoP BEFORE this
-- CAS. SQL checks freshness, binding and one-time use, NOT signature validity.
CREATE TABLE "SupervisorActorPreclaimChallenge" (
  "id" TEXT PRIMARY KEY,
  "nonce" TEXT NOT NULL UNIQUE CHECK (length("nonce") >= 32),
  "kid" TEXT NOT NULL CHECK (length("kid") > 0),
  "workerRole" TEXT NOT NULL CHECK (length("workerRole") > 0),
  "purpose" TEXT NOT NULL CHECK ("purpose" IN (
    'IMPLEMENTATION', 'INDEPENDENT_VERIFICATION')),
  "issuedAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "consumedAt" TIMESTAMPTZ,
  "executionId" TEXT UNIQUE REFERENCES "SupervisorExecution"("id") ON DELETE RESTRICT,
  CHECK ("expiresAt" = "issuedAt" + interval '60 seconds'),
  CHECK (("consumedAt" IS NULL) = ("executionId" IS NULL))
);
CREATE INDEX issue140_preclaim_expires_idx
 ON "SupervisorActorPreclaimChallenge" ("expiresAt")
 WHERE "consumedAt" IS NULL;

CREATE FUNCTION issue140_preclaim_cas_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."consumedAt" IS NOT NULL
    OR NEW."consumedAt" IS NULL OR NEW."executionId" IS NULL
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."nonce" IS DISTINCT FROM OLD."nonce"
    OR NEW."kid" IS DISTINCT FROM OLD."kid"
    OR NEW."workerRole" IS DISTINCT FROM OLD."workerRole"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."consumedAt" < OLD."issuedAt"
    OR NEW."consumedAt" >= OLD."expiresAt"
 THEN
   RAISE EXCEPTION 'issue140_preclaim_not_single_use'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER issue140_preclaim_cas
BEFORE UPDATE ON "SupervisorActorPreclaimChallenge"
FOR EACH ROW EXECUTE FUNCTION issue140_preclaim_cas_guard();
CREATE TRIGGER issue140_preclaim_no_delete
BEFORE DELETE ON "SupervisorActorPreclaimChallenge"
FOR EACH ROW EXECUTE FUNCTION issue140_forbid_proof_rewrite();

-- Fail closed on legacy claim proofs that lack the consumed challenge record.
-- preclaimSignature is validated by the API against the SERVER-LOADED
-- challenge and authority-controlled signing registry BEFORE ledger INSERT.
CREATE FUNCTION issue140_preclaim_claim_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE challenge_row "SupervisorActorPreclaimChallenge"%ROWTYPE;
DECLARE execution_row "SupervisorExecution"%ROWTYPE;
BEGIN
 SELECT * INTO challenge_row
 FROM "SupervisorActorPreclaimChallenge"
 WHERE "id"=NEW."proof"->>'preclaimChallengeId' FOR UPDATE;
 SELECT * INTO execution_row
 FROM "SupervisorExecution"
 WHERE "id"=NEW."executionId" FOR UPDATE;
 IF challenge_row."id" IS NULL
    OR challenge_row."consumedAt" IS NULL
    OR challenge_row."executionId" IS DISTINCT FROM NEW."executionId"
    OR challenge_row."nonce" IS DISTINCT FROM NEW."claimNonce"
    OR challenge_row."kid" IS DISTINCT FROM NEW."kid"
    OR challenge_row."workerRole" IS DISTINCT FROM execution_row."workerRole"
    OR challenge_row."purpose"  IS DISTINCT FROM
      COALESCE(execution_row."assignment"->>'executionPurpose',
       'IMPLEMENTATION')
    OR NEW."proof"->>'preclaimSignature' IS NULL
    OR length(NEW."proof"->>'preclaimSignature') < 60
 THEN
   RAISE EXCEPTION 'issue140_preclaim_binding_required'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER issue140_claim_requires_consumed_preclaim
BEFORE INSERT ON "SupervisorActorClaimProof"
FOR EACH ROW EXECUTE FUNCTION issue140_preclaim_claim_guard();

-- Restricted app role: challenge challenge issuance needs INSERT, claim
-- needs SELECT + UPDATE of consumedAt/executionId; no deletion or rebind.
-- DB owner/deploy actor MUST be separate from app credential in production.

-- END issue140-preclaim-challenge.local.sql

-- BEGIN issue140-exact-claim-offer.local.sql
-- ISSUE #140 LOCAL DISPOSABLE EXACT-CLAIM-OFFER POC; NOT A MIGRATION.
-- Requires original supervisor/liveness tables, local ledger, local preclaim SQL.
-- The server derives the offer from a QUEUED row and registered actor.
-- The offer is signed BEFORE any worker claim, then checked under DB locks.
ALTER TABLE "SupervisorActorPreclaimChallenge"
  ADD COLUMN "offeredExecutionId" TEXT NOT NULL
    REFERENCES "SupervisorExecution"("id") ON DELETE RESTRICT,
  ADD COLUMN "offerBinding" JSONB NOT NULL
    CHECK (jsonb_typeof("offerBinding")='object'),
  ADD COLUMN "offerAssignment" JSONB NOT NULL
    CHECK (jsonb_typeof("offerAssignment")='object'),
  -- The existing SupervisorTask.updatedAt column is timestamp WITHOUT TZ.
  -- Keep the exact UTC wall-clock value; never coerce it through MYT.
  ADD COLUMN "taskUpdatedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
  ADD COLUMN "offerAssignmentDigest" TEXT NOT NULL
    CHECK ("offerAssignmentDigest" ~ '^[0-9a-f]{64}$');

-- Prevent silent substitution of frozen offer fields during consumption.
CREATE OR REPLACE FUNCTION issue140_preclaim_cas_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."consumedAt" IS NOT NULL
    OR NEW."consumedAt" IS NULL OR NEW."executionId" IS NULL
    OR NEW."executionId" IS DISTINCT FROM OLD."offeredExecutionId"
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."nonce" IS DISTINCT FROM OLD."nonce"
    OR NEW."kid" IS DISTINCT FROM OLD."kid"
    OR NEW."workerRole" IS DISTINCT FROM OLD."workerRole"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."offeredExecutionId" IS DISTINCT FROM OLD."offeredExecutionId"
    OR NEW."offerBinding" IS DISTINCT FROM OLD."offerBinding"
    OR NEW."offerAssignment" IS DISTINCT FROM OLD."offerAssignment"
    OR NEW."taskUpdatedAt" IS DISTINCT FROM OLD."taskUpdatedAt"
    OR NEW."offerAssignmentDigest" IS DISTINCT FROM OLD."offerAssignmentDigest"
    OR NEW."consumedAt" < OLD."issuedAt"
    OR NEW."consumedAt" >= OLD."expiresAt"
 THEN
   RAISE EXCEPTION 'issue140_exact_offer_not_single_use'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;

-- SQL CAN enforce equality against server-persisted offer. The app MUST
-- cryptographically verify the two Ed25519 signatures before this INSERT.
CREATE FUNCTION issue140_enforce_exact_claim_offer()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE offer_row "SupervisorActorPreclaimChallenge"%ROWTYPE;
DECLARE execution_row "SupervisorExecution"%ROWTYPE;
DECLARE task_row "SupervisorTask"%ROWTYPE;
BEGIN
 SELECT * INTO offer_row FROM "SupervisorActorPreclaimChallenge"
   WHERE "id" = NEW."proof"->>'preclaimChallengeId' FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'issue140_exact_offer_required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO execution_row FROM "SupervisorExecution"
   WHERE "id"=NEW."executionId" FOR UPDATE;
 SELECT * INTO task_row FROM "SupervisorTask"
   WHERE "id"=NEW."taskId" FOR UPDATE;
 IF offer_row."consumedAt" IS NULL
   OR offer_row."executionId" IS DISTINCT FROM NEW."executionId"
   OR offer_row."offeredExecutionId" IS DISTINCT FROM NEW."executionId"
   OR offer_row."kid" IS DISTINCT FROM NEW."kid"
   OR offer_row."nonce" IS DISTINCT FROM NEW."claimNonce"
   OR offer_row."offerBinding" IS DISTINCT FROM NEW."proof"->'binding'
   OR NEW."proof"->>'kid' IS DISTINCT FROM NEW."kid"
   OR length(COALESCE(NEW."proof"->>'signature','')) < 80
   OR length(COALESCE(NEW."proof"->>'preclaimSignature','')) < 80
   OR execution_row."taskId" IS DISTINCT FROM NEW."taskId"
   OR execution_row."workerRole" IS DISTINCT FROM offer_row."workerRole"
   OR execution_row."status" IS DISTINCT FROM 'RUNNING'
   OR execution_row."claimEpoch" IS DISTINCT FROM NEW."claimEpoch"
   OR task_row."updatedAt" IS DISTINCT FROM offer_row."taskUpdatedAt"
   OR task_row."status" IS DISTINCT FROM (CASE WHEN offer_row."purpose" =
        'INDEPENDENT_VERIFICATION' THEN 'VERIFYING' ELSE 'WORKING' END)
   OR (execution_row."assignment" - 'bootstrapActor' -
     'claimEpoch' - 'runnerId' - 'leaseId' - 'workerCapability')
     IS DISTINCT FROM
     (offer_row."offerAssignment" - 'bootstrapActor' -
     'claimEpoch' - 'runnerId' - 'leaseId' - 'workerCapability')
   OR execution_row."assignment"->>'manifestHash'  IS DISTINCT FROM
     offer_row."offerBinding"->>'manifestHash'
   OR execution_row."assignment"->>'frozenBaseSha'  IS DISTINCT FROM
     offer_row."offerBinding"->>'frozenBaseSha'
   OR (execution_row."assignment"->>'claimEpoch')::integer  IS DISTINCT FROM
     (offer_row."offerBinding"->>'claimEpoch')::integer
   OR execution_row."assignment"->>'runnerId'  IS DISTINCT FROM
     offer_row."offerBinding"->>'runnerId'
   OR execution_row."assignment"->>'leaseId'  IS DISTINCT FROM
     offer_row."offerBinding"->>'leaseId'
   OR execution_row."assignment"->'bootstrapActor'->>'authenticatedAt'  IS DISTINCT FROM
     offer_row."offerBinding"->>'authenticatedAt'
   OR execution_row."assignment"->'bootstrapActor'->>'claimNonce'  IS DISTINCT FROM
     offer_row."nonce"
 THEN
   RAISE EXCEPTION 'issue140_exact_offer_binding_mismatch'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER issue140_claim_exact_offer_guard
BEFORE INSERT ON "SupervisorActorClaimProof"
FOR EACH ROW EXECUTE FUNCTION issue140_enforce_exact_claim_offer();

-- No modifications to production Prisma schema/migrations/roles.
-- Superuser/table-owner control can still circumvent these triggers;
-- production release needs separately authorized DB role ownership.

-- END issue140-exact-claim-offer.local.sql
