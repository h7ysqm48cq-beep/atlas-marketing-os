-- Reconcile PushSubscription schema.
-- This migration intentionally does not recreate the missing historical
-- 20260828090000 migration. It makes fresh and legacy databases converge
-- on the schema already present in production.

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE "PushSubscription"
  ADD COLUMN IF NOT EXISTS "id" TEXT,
  ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;

-- Give legacy rows stable non-null ids without requiring a PostgreSQL extension.
UPDATE "PushSubscription"
SET "id" =
  substr(md5("endpoint"), 1, 8) || '-' ||
  substr(md5("endpoint"), 9, 4) || '-' ||
  substr(md5("endpoint"), 13, 4) || '-' ||
  substr(md5("endpoint"), 17, 4) || '-' ||
  substr(md5("endpoint"), 21, 12)
WHERE "id" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PushSubscription"
    GROUP BY "id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PushSubscription contains duplicate ids';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PushSubscription"
    GROUP BY "endpoint"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PushSubscription contains duplicate endpoints';
  END IF;
END
$$;

ALTER TABLE "PushSubscription"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "enabled" SET DEFAULT true,
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Legacy startup DDL used TIMESTAMPTZ. Normalize to the production Prisma shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'PushSubscription'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE "PushSubscription"
      ALTER COLUMN "createdAt"
      TYPE TIMESTAMP(3)
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'PushSubscription'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE "PushSubscription"
      ALTER COLUMN "updatedAt"
      TYPE TIMESTAMP(3)
      USING "updatedAt" AT TIME ZONE 'UTC';
  END IF;
END
$$;

-- Remove a legacy primary key only when endpoint is the PK.
DO $$
DECLARE
  endpoint_pk TEXT;
BEGIN
  SELECT c.conname
  INTO endpoint_pk
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema()
    AND t.relname = 'PushSubscription'
    AND c.contype = 'p'
    AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (endpoint)'
  LIMIT 1;

  IF endpoint_pk IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE "PushSubscription" DROP CONSTRAINT %I',
      endpoint_pk
    );
  END IF;
END
$$;

-- Ensure id is the primary key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'PushSubscription'
      AND c.contype = 'p'
  ) THEN
    ALTER TABLE "PushSubscription"
      ADD CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id");
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key"
  ON "PushSubscription"("endpoint");

CREATE INDEX IF NOT EXISTS "PushSubscription_updatedAt_idx"
  ON "PushSubscription"("updatedAt");
