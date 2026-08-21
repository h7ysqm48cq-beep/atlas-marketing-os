-- ScheduledPost media must contain storage URLs only.
-- Inline/base64 payloads belong in object storage, never PostgreSQL.

ALTER TABLE "ScheduledPost"
DROP CONSTRAINT IF EXISTS
  "ScheduledPost_mediaUrls_no_inline_data";

ALTER TABLE "ScheduledPost"
ADD CONSTRAINT
  "ScheduledPost_mediaUrls_no_inline_data"
CHECK (
  strpos(
    chr(1) ||
      lower(
        array_to_string(
          "mediaUrls",
          chr(1)
        )
      ),
    chr(1) || 'data:'
  ) = 0
);

ALTER TABLE "ScheduledPost"
DROP CONSTRAINT IF EXISTS
  "ScheduledPost_mediaUrls_payload_guard";

ALTER TABLE "ScheduledPost"
ADD CONSTRAINT
  "ScheduledPost_mediaUrls_payload_guard"
CHECK (
  cardinality("mediaUrls") <= 20
  AND
  octet_length(
    array_to_string(
      "mediaUrls",
      ''
    )
  ) <= 131072
);
