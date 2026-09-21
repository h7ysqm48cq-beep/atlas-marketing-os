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
