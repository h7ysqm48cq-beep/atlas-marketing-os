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
