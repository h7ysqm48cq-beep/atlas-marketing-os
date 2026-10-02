ALTER TABLE "SocialChannel"
ADD COLUMN "hiddenAt" TIMESTAMP(3),
ADD COLUMN "hiddenReason" TEXT;

CREATE INDEX "SocialChannel_hiddenAt_idx" ON "SocialChannel"("hiddenAt");

ALTER TABLE "SocialChannel"
ALTER COLUMN "publishingPreference" SET DEFAULT 'BROWSER_RUNTIME';

UPDATE "SocialChannel"
SET "publishingPreference" = 'BROWSER_RUNTIME'
WHERE "platform" = 'FACEBOOK';

UPDATE "SocialChannel"
SET
  "hiddenAt" = CURRENT_TIMESTAMP,
  "hiddenReason" = 'INVALID_FACEBOOK_DISCOVERY'
WHERE "id" IN (
  'cmt9ycx23000s0ppcp2n8sqvh',
  'cmt6ygxua00050poeq0xg908p',
  'cmt8gb0mg00020pqt7ziigg4i',
  'cmt6ygwvt00030poex0ls4h9l'
);

UPDATE "SocialChannel"
SET
  "hiddenAt" = CURRENT_TIMESTAMP,
  "hiddenReason" = 'DUPLICATE_FACEBOOK_CHANNEL'
WHERE "id" = 'cmsxj7jsr00040pmenhdlrsy7';
