const { Client } =
  require("pg");

const {
  createClient,
} = require(
  "@supabase/supabase-js",
);

const sharp =
  require("sharp");

const APPLY =
  process.env.APPLY === "1";

const LIMIT =
  Math.max(
    1,
    Math.min(
      Number(
        process.env.LIMIT ||
          25,
      ),
      50,
    ),
  );

const BUCKET =
  process.env
    .SUPABASE_STORAGE_BUCKET ||
  "atlas-assets";

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms,
      ),
  );
}

function buildThumbnailPath(
  row,
) {
  const parts =
    String(
      row.storagePath ||
        "",
    )
      .split("/")
      .filter(Boolean);

  const originalName =
    parts.pop() ||
    row.id;

  const key =
    originalName
      .replace(
        /\.[^.]+$/,
        "",
      )
      .replace(
        /[^a-zA-Z0-9_-]/g,
        "-",
      );

  return [
    "brands",
    row.brandId,
    "thumbnails",
    "backfill",
    `${key}.webp`,
  ].join("/");
}

async function main() {
  if (
    !process.env.DATABASE_URL
  ) {
    throw new Error(
      "DATABASE_URL missing",
    );
  }

  const supabaseUrl =
    process.env.SUPABASE_URL;

  const supabaseKey =
    process.env
      .SUPABASE_SECRET_KEY ||
    process.env
      .SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !supabaseKey
  ) {
    throw new Error(
      "Supabase Storage credentials missing",
    );
  }

  const databaseUrl =
    new URL(
      process.env.DATABASE_URL,
    );

  const db =
    new Client({
      connectionString:
        process.env
          .DATABASE_URL,

      ssl:
        databaseUrl.hostname
          .includes(
            "supabase",
          )
          ? {
              rejectUnauthorized:
                false,
            }
          : undefined,
    });

  const supabase =
    createClient(
      supabaseUrl,
      supabaseKey,
      {
        auth: {
          persistSession:
            false,
          autoRefreshToken:
            false,
        },
      },
    );

  await db.connect();

  try {
    const count =
      await db.query(`
        SELECT
          count(*)::int
            AS count
        FROM "Asset"
        WHERE
          "type" = 'IMAGE'
          AND "storageProvider" = 'supabase'
          AND (
            "thumbnailUrl" IS NULL
            OR
            "thumbnailUrl" = "url"
          )
      `);

    console.log(
      "LEGACY THUMBNAILS:",
      count.rows[0].count,
    );

    if (
      count.rows[0].count ===
      0
    ) {
      console.log(
        "NOTHING TO BACKFILL",
      );
      return;
    }

    const rows =
      await db.query(
        `
        SELECT
          "id",
          "brandId",
          "url",
          "thumbnailUrl",
          "storagePath"
        FROM "Asset"
        WHERE
          "type" = 'IMAGE'
          AND "storageProvider" = 'supabase'
          AND (
            "thumbnailUrl" IS NULL
            OR
            "thumbnailUrl" = "url"
          )
        ORDER BY "createdAt" ASC
        LIMIT $1
        `,
        [LIMIT],
      );

    console.log(
      "BATCH SIZE:",
      rows.rowCount,
    );

    console.log(
      "MODE:",
      APPLY
        ? "APPLY"
        : "DRY RUN",
    );

    if (!APPLY) {
      console.log();
      console.log(
        "DRY RUN PASS — NO DATA MODIFIED",
      );
      return;
    }

    let succeeded = 0;
    let failed = 0;

    for (
      const [
        index,
        row,
      ]
      of rows.rows.entries()
    ) {
      try {
        console.log(
          `[${index + 1}/${rows.rowCount}] ${row.id}`,
        );

        const response =
          await fetch(
            row.url,
            {
              signal:
                AbortSignal.timeout(
                  60000,
                ),
            },
          );

        if (!response.ok) {
          throw new Error(
            `Original download HTTP ${response.status}`,
          );
        }

        const source =
          Buffer.from(
            await response.arrayBuffer(),
          );

        const thumbnail =
          await sharp(
            source,
            {
              failOn:
                "none",
            },
          )
            .rotate()
            .resize({
              width: 960,
              height: 960,
              fit: "inside",
              withoutEnlargement:
                true,
            })
            .webp({
              quality: 78,
              effort: 4,
            })
            .toBuffer();

        const thumbnailPath =
          buildThumbnailPath(
            row,
          );

        const {
          error:
            uploadError,
        } =
          await supabase.storage
            .from(BUCKET)
            .upload(
              thumbnailPath,
              thumbnail,
              {
                contentType:
                  "image/webp",
                cacheControl:
                  "31536000",
                upsert: true,
              },
            );

        if (uploadError) {
          throw new Error(
            uploadError.message,
          );
        }

        const { data } =
          supabase.storage
            .from(BUCKET)
            .getPublicUrl(
              thumbnailPath,
            );

        if (
          !data.publicUrl
        ) {
          throw new Error(
            "Public thumbnail URL missing",
          );
        }

        const updated =
          await db.query(
            `
            UPDATE "Asset"
            SET
              "thumbnailUrl" = $2
            WHERE
              "id" = $1
              AND (
                "thumbnailUrl" IS NULL
                OR
                "thumbnailUrl" = "url"
              )
            `,
            [
              row.id,
              data.publicUrl,
            ],
          );

        if (
          updated.rowCount !==
          1
        ) {
          throw new Error(
            "Concurrent asset update detected",
          );
        }

        succeeded += 1;

        console.log(
          "  PASS",
          (
            thumbnail.length /
            1024
          ).toFixed(1),
          "KB",
        );
      } catch (error) {
        failed += 1;

        console.error(
          "  FAIL:",
          error instanceof
          Error
            ? error.message
            : String(error),
        );
      }

      await sleep(150);
    }

    console.log();
    console.log(
      "SUCCEEDED:",
      succeeded,
    );

    console.log(
      "FAILED:",
      failed,
    );

    if (failed) {
      process.exitCode = 2;
    }
  } finally {
    await db.end();
  }
}

main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
