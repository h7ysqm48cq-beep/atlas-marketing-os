-- ISSUE #140 disposable-only relational/transactional test, NOT real signatures.
-- Run AFTER repo Supervisor table migrations + issue140-attestation-ledger.local.sql.
\set ON_ERROR_STOP on
CREATE FUNCTION issue140_expect_failure(statement TEXT, expected_state TEXT)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE actual_state TEXT;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'issue140_expected_failure_did_not_occur'
      USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state IS DISTINCT FROM expected_state THEN
      RAISE EXCEPTION 'issue140_wrong_failure_expected_%,got_%',
        expected_state, actual_state;
    END IF;
  END;
END;
$fn$;

INSERT INTO "SupervisorTask" ("id","objective","owner","status","updatedAt")
VALUES
('issue140-ledger-A','local-only','engineering','VERIFYING',clock_timestamp()),
('issue140-ledger-B','local-only','engineering','VERIFYING',clock_timestamp()),
('issue140-ledger-C','local-only','engineering','VERIFYING',clock_timestamp());

INSERT INTO "SupervisorExecution" (
"id","taskId","workerRole","status","assignment","runnerId","claimEpoch")
SELECT
'issue140-exec-' || suffix,
'issue140-ledger-' || suffix,
'engineering',
'RUNNING',
jsonb_build_object(
 'taskId','issue140-ledger-' || suffix,
 'executionId','issue140-exec-' || suffix,
 'claimEpoch',1,
 'bootstrapActor',jsonb_build_object(
    'kid','kid-' || suffix,
    'claimNonce',CASE WHEN suffix='B' THEN 'nonce-A-0001'
      ELSE 'nonce-' || suffix || '-0001' END
 )
),
'runner-' || suffix,
1
FROM (VALUES ('A'),('B'),('C')) AS t(suffix);

-- No attestation can be created for a different epoch, task, or nonce.
SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorClaimProof"
 ("executionId","taskId","claimEpoch","claimNonce","kid","proof","proofDigest")
 VALUES ('issue140-exec-A','issue140-ledger-A',2,'nonce-A-0001',
 'kid-A','{"signature":"synthetic"}',repeat('a',64))
$sql$, '23514');

-- A claim row can be created while the execution is RUNNING. In the REAL
-- producer it MUST be inserted within the same transaction as RUNNING claim.
INSERT INTO "SupervisorActorClaimProof"
("executionId","taskId","claimEpoch","claimNonce","kid","proof","proofDigest")
VALUES ('issue140-exec-A','issue140-ledger-A',1,'nonce-A-0001',
'kid-A','{"signature":"synthetic-claim-A"}',repeat('a',64));

-- Duplicate nonce is rejected across executions, even with distinct IDs.
SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorClaimProof"
 ("executionId","taskId","claimEpoch","claimNonce","kid","proof","proofDigest")
 VALUES ('issue140-exec-B','issue140-ledger-B',1,'nonce-A-0001',
 'kid-B','{"signature":"synthetic-claim-B"}',repeat('b',64))
$sql$, '23505');
UPDATE "SupervisorExecution"
SET "assignment" = jsonb_set("assignment",
 '{bootstrapActor,claimNonce}','"nonce-B-0001"')
WHERE "id" = 'issue140-exec-B';

INSERT INTO "SupervisorActorClaimProof"
("executionId","taskId","claimEpoch","claimNonce","kid","proof","proofDigest")
VALUES ('issue140-exec-B','issue140-ledger-B',1,'nonce-B-0001',
'kid-B','{"signature":"synthetic-claim-B"}',repeat('b',64));

-- Claim proof is write-once, even for table owner; a second INSERT fails.
SELECT issue140_expect_failure($sql$
 UPDATE "SupervisorActorClaimProof" SET "kid"='forged'
 WHERE "executionId"='issue140-exec-A'
$sql$, '23514');
SELECT issue140_expect_failure($sql$
 DELETE FROM "SupervisorActorClaimProof" WHERE "executionId"='issue140-exec-A'
$sql$, '23514');
SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorClaimProof"
 ("executionId","taskId","claimEpoch","claimNonce","kid","proof","proofDigest")
 VALUES ('issue140-exec-A','issue140-ledger-A',1,'nonce-A-0001',
 'kid-A','{"signature":"synthetic"}',repeat('a',64))
$sql$, '23505');

-- A signed completion must have a persisted claim and a COMPLETED execution.
SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorCompletionProof"
 ("executionId","taskId","claimEpoch","claimProofDigest","kid","proof")
 VALUES ('issue140-exec-A','issue140-ledger-A',1,repeat('a',64),
 'kid-A','{"signature":"synthetic-completion-A"}')
$sql$, '23514');

UPDATE "SupervisorExecution"
SET "status"='COMPLETED',"result"='{"summary":"synthetic"}'
WHERE "id"='issue140-exec-A';

SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorCompletionProof"
 ("executionId","taskId","claimEpoch","claimProofDigest","kid","proof")
 VALUES ('issue140-exec-A','issue140-ledger-A',1,repeat('f',64),
 'kid-A','{"signature":"synthetic-completion-A"}')
$sql$, '23514');

INSERT INTO "SupervisorActorCompletionProof"
("executionId","taskId","claimEpoch","claimProofDigest","kid","proof")
VALUES ('issue140-exec-A','issue140-ledger-A',1,repeat('a',64),
'kid-A','{"signature":"synthetic-completion-A"}');

SELECT issue140_expect_failure($sql$
 UPDATE "SupervisorActorCompletionProof" SET "kid"='forged'
 WHERE "executionId"='issue140-exec-A'
$sql$, '23514');
SELECT issue140_expect_failure($sql$
 DELETE FROM "SupervisorActorCompletionProof"
 WHERE "executionId"='issue140-exec-A'
$sql$, '23514');
SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorCompletionProof"
 ("executionId","taskId","claimEpoch","claimProofDigest","kid","proof")
 VALUES ('issue140-exec-A','issue140-ledger-A',1,repeat('a',64),
 'kid-A','{"signature":"duplicate"}')
$sql$, '23505');

-- Foreign key RESTRICT guards deletion of base execution with proof.
SELECT issue140_expect_failure($sql$
 DELETE FROM "SupervisorExecution" WHERE "id"='issue140-exec-A'
$sql$, '23503');

-- A completed execution without a persisted claim cannot self-attest.
UPDATE "SupervisorExecution" SET "status"='COMPLETED',
 "result"='{"summary":"synthetic-no-claim"}'
WHERE "id"='issue140-exec-C';
SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorCompletionProof"
 ("executionId","taskId","claimEpoch","claimProofDigest","kid","proof")
 VALUES ('issue140-exec-C','issue140-ledger-C',1,repeat('c',64),
 'kid-C','{"signature":"synthetic-no-claim"}')
$sql$, '23514');

-- Proof-bearing tasks cannot be cascaded away via the base task FK.
SELECT issue140_expect_failure($sql$
 DELETE FROM "SupervisorTask" WHERE "id"='issue140-ledger-A'
$sql$, '23503');

-- Prove that the execution transition AND attestation insert roll back
-- together if the application performs BOTH in one transaction.
INSERT INTO "SupervisorTask" ("id","objective","owner","status","updatedAt")
VALUES ('issue140-ledger-D','atomic-rollback','engineering',
'VERIFYING',clock_timestamp());
INSERT INTO "SupervisorExecution"
("id","taskId","workerRole","status","assignment","runnerId","claimEpoch")
VALUES ('issue140-exec-D','issue140-ledger-D','engineering','QUEUED',
jsonb_build_object(
 'taskId','issue140-ledger-D','executionId','issue140-exec-D',
 'claimEpoch',0,
 'bootstrapActor',jsonb_build_object(
  'kid','kid-D','claimNonce','nonce-D-0001')
),NULL,0);
DO $do$
BEGIN
  BEGIN
    UPDATE "SupervisorExecution" SET "status"='RUNNING',
      "runnerId"='runner-D',
      "claimEpoch"=1,
      "assignment" = jsonb_set("assignment",'{claimEpoch}','1'::jsonb)
    WHERE "id"='issue140-exec-D' AND "status"='QUEUED';
    INSERT INTO "SupervisorActorClaimProof"
    ("executionId","taskId","claimEpoch","claimNonce","kid","proof","proofDigest")
    VALUES ('issue140-exec-D','issue140-ledger-D',1,'nonce-D-0001',
    'kid-D','{"signature":"synthetic-claim-D"}',repeat('d',64));
    RAISE EXCEPTION 'test-induced-rollback';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
END;
$do$;
DO $do$
BEGIN
  IF EXISTS(SELECT 1 FROM "SupervisorActorClaimProof"
     WHERE "executionId"='issue140-exec-D') THEN
    RAISE EXCEPTION 'issue140_failed_proof_insert_not_rolled_back';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "SupervisorExecution"
     WHERE "id"='issue140-exec-D' AND "status"='QUEUED'
       AND "claimEpoch"=0 AND "runnerId" IS NULL) THEN
    RAISE EXCEPTION 'issue140_failed_execution_transition_not_rolled_back';
  END IF;
  IF (SELECT count(*) FROM "SupervisorActorClaimProof") <> 2
     OR (SELECT count(*) FROM "SupervisorActorCompletionProof") <> 1 THEN
    RAISE EXCEPTION 'issue140_wrong_ledger_counts';
  END IF;
END;
$do$;
-- Refuse a proof created outside the actual claim transition.
SELECT issue140_expect_failure($sql$
 INSERT INTO "SupervisorActorClaimProof"
 ("executionId","taskId","claimEpoch","claimNonce","kid","proof","proofDigest")
 VALUES ('issue140-exec-D','issue140-ledger-D',1,'nonce-D-0001',
 'kid-D','{"signature":"synthetic-claim-D"}',repeat('d',64))
$sql$, '23514');

-- This is a distinct restricted ledger-writer role, not the schema owner.
DO $do$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='issue140_ledger_writer') THEN
    CREATE ROLE issue140_ledger_writer NOLOGIN;
  END IF;
END;
$do$;
GRANT USAGE ON SCHEMA public TO issue140_ledger_writer;
GRANT SELECT,INSERT ON "SupervisorActorClaimProof",
 "SupervisorActorCompletionProof" TO issue140_ledger_writer;
SET ROLE issue140_ledger_writer;
SELECT issue140_expect_failure($sql$
 UPDATE "SupervisorActorClaimProof" SET "kid"='forged'
 WHERE "executionId"='issue140-exec-A'
$sql$, '42501');
SELECT issue140_expect_failure($sql$
 TRUNCATE "SupervisorActorCompletionProof"
$sql$, '42501');
RESET ROLE;
SELECT 'ISSUE140_LOCAL_LEDGER_ASSERTIONS_PASS' AS result;
