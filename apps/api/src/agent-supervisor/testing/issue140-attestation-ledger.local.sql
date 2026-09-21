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
