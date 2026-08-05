"use client";

import {
  useMemo,
  useState,
} from "react";
import {
  API_URL,
} from "@/lib/api";
import styles from "./BrowserAccountPasteImporter.module.css";

type ImportRow = {
  rowNumber: number;
  email: string;
  password: string;
  proxyHost: string;
  proxyPort: number | null;
  proxyUsername: string;
  proxyPassword: string;
};

type ImportResult = {
  rowNumber: number;
  email: string;
  success: boolean;
  message: string;
};

type Props = {
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

const HEADERS = [
  "email",
  "password",
  "proxyHost",
  "proxyPort",
  "proxyUsername",
  "proxyPassword",
] as const;

function normalizeHeader(
  value: string,
) {
  return value
    .trim()
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
}

function splitRow(
  line: string,
) {
  return line.includes("\t")
    ? line.split("\t")
    : line.split(",");
}

function parseRows(
  value: string,
): ImportRow[] {
  const lines =
    value
      .replace(/\r/g, "")
      .split("\n")
      .map(
        (line) =>
          line.trimEnd(),
      )
      .filter(
        (line) =>
          line.trim(),
      );

  if (!lines.length) {
    return [];
  }

  const normalizedHeaders =
    HEADERS.map(
      normalizeHeader,
    );

  const firstRow =
    splitRow(
      lines[0],
    ).map(
      normalizeHeader,
    );

  const hasHeader =
    firstRow.some(
      (cell) =>
        normalizedHeaders.includes(
          cell,
        ),
    );

  const headers =
    hasHeader
      ? firstRow
      : normalizedHeaders;

  const dataLines =
    hasHeader
      ? lines.slice(1)
      : lines;

  return dataLines.map(
    (line, index) => {
      const cells =
        splitRow(line);

      function get(
        name:
          typeof HEADERS[number],
      ) {
        const column =
          headers.indexOf(
            normalizeHeader(
              name,
            ),
          );

        return column >= 0
          ? (
              cells[column] ||
              ""
            ).trim()
          : "";
      }

      const port =
        Number(
          get("proxyPort"),
        );

      return {
        rowNumber:
          index +
          (
            hasHeader
              ? 2
              : 1
          ),

        email:
          get("email")
            .toLowerCase(),

        password:
          get("password"),

        proxyHost:
          get("proxyHost"),

        proxyPort:
          Number.isInteger(
            port,
          ) &&
          port > 0 &&
          port <= 65535
            ? port
            : null,

        proxyUsername:
          get(
            "proxyUsername",
          ),

        proxyPassword:
          get(
            "proxyPassword",
          ),
      };
    },
  );
}

function validEmail(
  value: string,
) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value,
  );
}

export function BrowserAccountPasteImporter({
  onClose,
  onImported,
}: Props) {
  const [
    pastedText,
    setPastedText,
  ] = useState("");

  const [
    importing,
    setImporting,
  ] = useState(false);

  const [
    results,
    setResults,
  ] = useState<
    ImportResult[]
  >([]);

  const rows =
    useMemo(
      () =>
        parseRows(
          pastedText,
        ),
      [
        pastedText,
      ],
    );

  const invalidRows =
    rows.filter(
      (row) => {
        if (
          !validEmail(
            row.email,
          ) ||
          !row.password
        ) {
          return true;
        }

        if (
          row.proxyHost &&
          !row.proxyPort
        ) {
          return true;
        }

        return false;
      },
    );

  async function importAccounts() {
    if (
      importing ||
      !rows.length ||
      invalidRows.length
    ) {
      return;
    }

    setImporting(
      true,
    );
    setResults([]);

    const nextResults:
      ImportResult[] = [];

    try {
      for (
        const row
        of rows
      ) {
        try {
          const hasProxy =
            Boolean(
              row.proxyHost,
            );

          const response =
            await fetch(
              `${API_URL}/browser-runtime/accounts`,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    facebookEmail:
                      row.email,

                    facebookPassword:
                      row.password,

                    proxyType:
                      hasProxy
                        ? "HTTP"
                        : "DIRECT",

                    proxyHost:
                      hasProxy
                        ? row.proxyHost
                        : null,

                    proxyPort:
                      hasProxy
                        ? row.proxyPort
                        : null,

                    proxyUsername:
                      hasProxy
                        ? (
                            row.proxyUsername ||
                            null
                          )
                        : null,

                    proxyPassword:
                      hasProxy
                        ? (
                            row.proxyPassword ||
                            null
                          )
                        : null,

                    proxyCountry:
                      hasProxy
                        ? "MY"
                        : null,

                    browserEngine:
                      "chromium",

                    operatingSystem:
                      "macOS",

                    screenWidth:
                      1440,

                    screenHeight:
                      900,

                    deviceScaleFactor:
                      2,

                    locale:
                      "en-MY",

                    timezone:
                      "Asia/Kuala_Lumpur",

                    identityLocked:
                      true,
                  }),
              },
            );

          const body =
            await response
              .json()
              .catch(
                () => ({}),
              ) as {
                message?: string;
              };

          if (!response.ok) {
            throw new Error(
              body.message ||
              `Request failed with status ${response.status}.`,
            );
          }

          nextResults.push({
            rowNumber:
              row.rowNumber,
            email:
              row.email,
            success:
              true,
            message:
              "Account created.",
          });
        } catch (error) {
          nextResults.push({
            rowNumber:
              row.rowNumber,
            email:
              row.email,
            success:
              false,
            message:
              error instanceof
                Error
                ? error.message
                : "Unable to create account.",
          });
        }

        setResults(
          [
            ...nextResults,
          ],
        );
      }

      if (
        nextResults.some(
          (result) =>
            result.success,
        )
      ) {
        await onImported();
      }
    } finally {
      setImporting(
        false,
      );
    }
  }

  const successCount =
    results.filter(
      (result) =>
        result.success,
    ).length;

  const failedCount =
    results.filter(
      (result) =>
        !result.success,
    ).length;

  return (
    <div className={styles.importer}>
      <section className={styles.instructions}>
        <strong>
          Paste accounts from Excel
        </strong>

        <p>
          Copy the six columns below from Excel
          and paste them into the box.
          Proxy fields may be left empty.
        </p>

        <code>
          {HEADERS.join(
            "\t",
          )}
        </code>
      </section>

      <textarea
        autoFocus
        className={styles.textarea}
        disabled={importing}
        placeholder={
          "email\tpassword\tproxyHost\tproxyPort\tproxyUsername\tproxyPassword\naccount@gmail.com\tpassword123\t1.2.3.4\t8000\tproxyuser\tproxypass"
        }
        value={pastedText}
        onChange={(event) => {
          setPastedText(
            event.target.value,
          );
          setResults([]);
        }}
      />

      <div className={styles.summary}>
        <span>
          Parsed:{" "}
          <strong>
            {rows.length}
          </strong>
        </span>

        <span>
          Invalid:{" "}
          <strong>
            {
              invalidRows.length
            }
          </strong>
        </span>

        {results.length ? (
          <>
            <span>
              Created:{" "}
              <strong>
                {successCount}
              </strong>
            </span>

            <span>
              Failed:{" "}
              <strong>
                {failedCount}
              </strong>
            </span>
          </>
        ) : null}
      </div>

      {rows.length ? (
        <div className={styles.preview}>
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Email</th>
                <th>Password</th>
                <th>Proxy</th>
                <th>Proxy Login</th>
              </tr>
            </thead>

            <tbody>
              {rows
                .slice(
                  0,
                  30,
                )
                .map(
                  (row) => {
                    const invalid =
                      invalidRows.some(
                        (
                          invalidRow,
                        ) =>
                          invalidRow
                            .rowNumber ===
                          row.rowNumber,
                      );

                    return (
                      <tr
                        className={
                          invalid
                            ? styles.invalidRow
                            : undefined
                        }
                        key={
                          row.rowNumber
                        }
                      >
                        <td>
                          {
                            row.rowNumber
                          }
                        </td>

                        <td>
                          {
                            row.email ||
                            "Missing"
                          }
                        </td>

                        <td>
                          {row.password
                            ? "••••••••"
                            : "Missing"}
                        </td>

                        <td>
                          {row.proxyHost
                            ? `${row.proxyHost}:${row.proxyPort || "Missing"}`
                            : "DIRECT"}
                        </td>

                        <td>
                          {row.proxyUsername
                            ? "Configured"
                            : "—"}
                        </td>
                      </tr>
                    );
                  },
                )}
            </tbody>
          </table>
        </div>
      ) : null}

      {results.length ? (
        <div className={styles.results}>
          {results.map(
            (result) => (
              <div
                className={
                  result.success
                    ? styles.resultSuccess
                    : styles.resultFailed
                }
                key={
                  `${result.rowNumber}-${result.email}`
                }
              >
                <strong>
                  Row {
                    result.rowNumber
                  } · {
                    result.email
                  }
                </strong>

                <span>
                  {result.message}
                </span>
              </div>
            ),
          )}
        </div>
      ) : null}

      <div className={styles.actions}>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={importing}
          onClick={onClose}
        >
          Close
        </button>

        <button
          className={styles.primaryButton}
          type="button"
          disabled={
            importing ||
            !rows.length ||
            invalidRows.length >
              0
          }
          onClick={() =>
            void importAccounts()
          }
        >
          {importing
            ? `Creating ${results.length}/${rows.length}…`
            : `Create ${rows.length} Account${rows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
