"use client";

import {
  useMemo,
  useState,
} from "react";
import { API_URL } from "@/lib/api";
import styles from "./BulkLoginImporter.module.css";

type Channel = {
  id: string;
  name: string;
  platform: string;
  username?: string | null;
  externalId?: string | null;
};

type ProxyType =
  | "DIRECT"
  | "HTTP"
  | "HTTPS"
  | "SOCKS5";

type ImportRow = {
  rowNumber: number;
  accountName: string;
  channelId: string;
  email: string;
  password: string;
  twoFactorSecret: string;
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
  proxyCountry: string;
  profileName: string;
  matchedChannelId: string | null;
  matchedChannelName: string | null;
  errors: string[];
  status:
    | "READY"
    | "INVALID"
    | "SAVING"
    | "SAVED"
    | "FAILED";
  resultMessage: string;
};

type BulkLoginImporterProps = {
  channels: Channel[];
  onPrepared: (
    channelIds: string[],
  ) => void;
};

const REQUIRED_HEADERS = [
  "accountname",
];

const TEMPLATE = [
  [
    "Account Name",
    "Channel ID",
    "Facebook Email",
    "Password",
    "2FA Secret",
    "Proxy Type",
    "Proxy Host",
    "Proxy Port",
    "Proxy Username",
    "Proxy Password",
    "Country",
    "Profile Name",
  ].join("\t"),
  [
    "MGM满贯门SportsNews",
    "",
    "account@example.com",
    "temporary-password",
    "",
    "HTTP",
    "proxy.example.com",
    "8000",
    "proxy-user",
    "proxy-password",
    "MY",
    "MGM Sports Browser",
  ].join("\t"),
].join("\n");

function normalizeHeader(
  value: string,
) {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      "",
    );
}

function splitLine(
  line: string,
  delimiter: string,
) {
  if (delimiter === "\t") {
    return line
      .split("\t")
      .map((value) =>
        value.trim(),
      );
  }

  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (
    let index = 0;
    index < line.length;
    index += 1
  ) {
    const character =
      line[index];

    if (character === '"') {
      if (
        quoted &&
        line[index + 1] === '"'
      ) {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (
      character === delimiter &&
      !quoted
    ) {
      values.push(
        current.trim(),
      );
      current = "";
      continue;
    }

    current += character;
  }

  values.push(
    current.trim(),
  );

  return values;
}

function detectDelimiter(
  firstLine: string,
) {
  if (
    firstLine.includes("\t")
  ) {
    return "\t";
  }

  const commaCount =
    (
      firstLine.match(
        /,/g,
      ) || []
    ).length;

  const semicolonCount =
    (
      firstLine.match(
        /;/g,
      ) || []
    ).length;

  return semicolonCount >
    commaCount
    ? ";"
    : ",";
}

function readValue(
  values: string[],
  headerMap: Map<
    string,
    number
  >,
  aliases: string[],
) {
  for (
    const alias of aliases
  ) {
    const index =
      headerMap.get(
        normalizeHeader(
          alias,
        ),
      );

    if (
      index !== undefined
    ) {
      return values[index] ||
        "";
    }
  }

  return "";
}

function normalizeProxyType(
  value: string,
): ProxyType {
  const normalized =
    value
      .trim()
      .toUpperCase();

  if (
    normalized === "HTTP" ||
    normalized === "HTTPS" ||
    normalized === "SOCKS5"
  ) {
    return normalized;
  }

  return "DIRECT";
}

function findChannel(
  channels: Channel[],
  channelId: string,
  accountName: string,
) {
  const facebookChannels =
    channels.filter(
      (channel) =>
        channel.platform ===
        "FACEBOOK",
    );

  if (channelId.trim()) {
    const exactId =
      facebookChannels.find(
        (channel) =>
          channel.id ===
          channelId.trim(),
      );

    if (exactId) {
      return exactId;
    }
  }

  const normalizedName =
    accountName
      .trim()
      .toLowerCase();

  if (!normalizedName) {
    return null;
  }

  return (
    facebookChannels.find(
      (channel) =>
        channel.name
          .trim()
          .toLowerCase() ===
        normalizedName,
    ) ||
    facebookChannels.find(
      (channel) =>
        channel.username
          ?.trim()
          .toLowerCase() ===
        normalizedName,
    ) ||
    null
  );
}

function validateRow(
  row: Omit<
    ImportRow,
    | "errors"
    | "status"
    | "resultMessage"
  >,
) {
  const errors: string[] =
    [];

  if (
    !row.accountName.trim() &&
    !row.channelId.trim()
  ) {
    errors.push(
      "Account Name or Channel ID is required.",
    );
  }

  if (
    !row.matchedChannelId
  ) {
    errors.push(
      "No matching Facebook Channel was found.",
    );
  }

  if (
    row.proxyType !==
    "DIRECT"
  ) {
    if (
      !row.proxyHost.trim()
    ) {
      errors.push(
        "Proxy Host is required.",
      );
    }

    const proxyPort =
      Number(
        row.proxyPort,
      );

    if (
      !Number.isInteger(
        proxyPort,
      ) ||
      proxyPort < 1 ||
      proxyPort > 65535
    ) {
      errors.push(
        "Proxy Port must be between 1 and 65535.",
      );
    }
  }

  return errors;
}

async function readJson(
  response: Response,
) {
  const raw =
    await response.text();

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(
      raw,
    ) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      message: raw,
    };
  }
}

function responseMessage(
  body: Record<
    string,
    unknown
  >,
  fallback: string,
) {
  return typeof body.message ===
    "string" &&
    body.message.trim()
    ? body.message
    : fallback;
}

export function BulkLoginImporter({
  channels,
  onPrepared,
}: BulkLoginImporterProps) {
  const [open, setOpen] =
    useState(false);

  const [rawInput, setRawInput] =
    useState("");

  const [rows, setRows] =
    useState<ImportRow[]>([]);

  const [selectedRows, setSelectedRows] =
    useState<Set<number>>(
      new Set(),
    );

  const [parsingError, setParsingError] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const selectedCount =
    selectedRows.size;

  const readySelectedRows =
    useMemo(
      () =>
        rows.filter(
          (row) =>
            selectedRows.has(
              row.rowNumber,
            ) &&
            row.status !==
              "INVALID",
        ),
      [rows, selectedRows],
    );

  function parseInput() {
    setParsingError("");

    const lines =
      rawInput
        .replace(
          /\r\n/g,
          "\n",
        )
        .replace(
          /\r/g,
          "\n",
        )
        .split("\n")
        .filter(
          (line) =>
            line.trim(),
        );

    if (
      lines.length < 2
    ) {
      setParsingError(
        "Paste a header row and at least one account row.",
      );
      return;
    }

    const delimiter =
      detectDelimiter(
        lines[0],
      );

    const headers =
      splitLine(
        lines[0],
        delimiter,
      );

    const headerMap =
      new Map<
        string,
        number
      >();

    headers.forEach(
      (header, index) => {
        headerMap.set(
          normalizeHeader(
            header,
          ),
          index,
        );
      },
    );

    const missingHeaders =
      REQUIRED_HEADERS.filter(
        (header) =>
          !headerMap.has(
            header,
          ),
      );

    if (
      missingHeaders.length
    ) {
      setParsingError(
        [
          "Missing required column:",
          "Account Name.",
          "Use the template provided.",
        ].join(" "),
      );
      return;
    }

    const parsedRows =
      lines
        .slice(1)
        .map(
          (
            line,
            lineIndex,
          ) => {
            const values =
              splitLine(
                line,
                delimiter,
              );

            const accountName =
              readValue(
                values,
                headerMap,
                [
                  "Account Name",
                  "Account",
                  "Channel Name",
                ],
              );

            const channelId =
              readValue(
                values,
                headerMap,
                [
                  "Channel ID",
                  "ChannelId",
                ],
              );

            const matchedChannel =
              findChannel(
                channels,
                channelId,
                accountName,
              );

            const baseRow = {
              rowNumber:
                lineIndex + 2,
              accountName,
              channelId,
              email:
                readValue(
                  values,
                  headerMap,
                  [
                    "Facebook Email",
                    "Email",
                    "Login Email",
                  ],
                ),
              password:
                readValue(
                  values,
                  headerMap,
                  [
                    "Password",
                    "Facebook Password",
                  ],
                ),
              twoFactorSecret:
                readValue(
                  values,
                  headerMap,
                  [
                    "2FA Secret",
                    "Two Factor Secret",
                    "OTP Secret",
                  ],
                ),
              proxyType:
                normalizeProxyType(
                  readValue(
                    values,
                    headerMap,
                    [
                      "Proxy Type",
                      "ProxyType",
                    ],
                  ),
                ),
              proxyHost:
                readValue(
                  values,
                  headerMap,
                  [
                    "Proxy Host",
                    "ProxyHost",
                    "Host",
                  ],
                ),
              proxyPort:
                readValue(
                  values,
                  headerMap,
                  [
                    "Proxy Port",
                    "ProxyPort",
                    "Port",
                  ],
                ),
              proxyUsername:
                readValue(
                  values,
                  headerMap,
                  [
                    "Proxy Username",
                    "Proxy User",
                  ],
                ),
              proxyPassword:
                readValue(
                  values,
                  headerMap,
                  [
                    "Proxy Password",
                    "Proxy Pass",
                  ],
                ),
              proxyCountry:
                readValue(
                  values,
                  headerMap,
                  [
                    "Country",
                    "Proxy Country",
                  ],
                ),
              profileName:
                readValue(
                  values,
                  headerMap,
                  [
                    "Profile Name",
                    "Browser Profile Name",
                  ],
                ),
              matchedChannelId:
                matchedChannel?.id ||
                null,
              matchedChannelName:
                matchedChannel?.name ||
                null,
            };

            const errors =
              validateRow(
                baseRow,
              );

            return {
              ...baseRow,
              errors,
              status:
                errors.length
                  ? "INVALID"
                  : "READY",
              resultMessage: "",
            } satisfies ImportRow;
          },
        );

    setRows(parsedRows);

    setSelectedRows(
      new Set(
        parsedRows
          .filter(
            (row) =>
              row.status ===
              "READY",
          )
          .map(
            (row) =>
              row.rowNumber,
          ),
      ),
    );
  }

  function toggleRow(
    rowNumber: number,
  ) {
    setSelectedRows(
      (current) => {
        const next =
          new Set(current);

        if (
          next.has(
            rowNumber,
          )
        ) {
          next.delete(
            rowNumber,
          );
        } else {
          next.add(
            rowNumber,
          );
        }

        return next;
      },
    );
  }

  function selectAllReady() {
    setSelectedRows(
      new Set(
        rows
          .filter(
            (row) =>
              row.status !==
              "INVALID",
          )
          .map(
            (row) =>
              row.rowNumber,
          ),
      ),
    );
  }

  function clearSelection() {
    setSelectedRows(
      new Set(),
    );
  }

  async function prepareSelected() {
    if (
      !readySelectedRows.length
    ) {
      setParsingError(
        "Select at least one valid row.",
      );
      return;
    }

    setSaving(true);
    setParsingError("");

    const successfullyPrepared:
      string[] = [];

    for (
      const row
      of readySelectedRows
    ) {
      if (
        !row.matchedChannelId
      ) {
        continue;
      }

      setRows(
        (current) =>
          current.map(
            (item) =>
              item.rowNumber ===
              row.rowNumber
                ? {
                    ...item,
                    status:
                      "SAVING",
                    resultMessage:
                      "Saving runtime profile…",
                  }
                : item,
          ),
      );

      try {
        const proxyPort =
          row.proxyType ===
          "DIRECT"
            ? null
            : Number(
                row.proxyPort,
              );

        const response =
          await fetch(
            `${API_URL}/automation/channels/${row.matchedChannelId}/runtime-profile`,
            {
              method: "PUT",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  browserProfileName:
                    row.profileName.trim() ||
                    `${row.matchedChannelName} Browser`,
                  locale:
                    "en-MY",
                  timezone:
                    "Asia/Kuala_Lumpur",
                  proxyType:
                    row.proxyType,
                  proxyHost:
                    row.proxyType ===
                    "DIRECT"
                      ? null
                      : row.proxyHost.trim(),
                  proxyPort,
                  proxyUsername:
                    row.proxyType ===
                    "DIRECT"
                      ? null
                      : row.proxyUsername ||
                        undefined,
                  proxyPassword:
                    row.proxyType ===
                    "DIRECT"
                      ? null
                      : row.proxyPassword ||
                        undefined,
                  proxyCountry:
                    row.proxyType ===
                    "DIRECT"
                      ? null
                      : row.proxyCountry.trim() ||
                        null,
                }),
            },
          );

        const body =
          await readJson(
            response,
          );

        if (!response.ok) {
          throw new Error(
            responseMessage(
              body,
              "Unable to save runtime profile.",
            ),
          );
        }

        successfullyPrepared.push(
          row.matchedChannelId,
        );

        setRows(
          (current) =>
            current.map(
              (item) =>
                item.rowNumber ===
                row.rowNumber
                  ? {
                      ...item,
                      status:
                        "SAVED",
                      resultMessage:
                        "Profile saved and ready for login.",
                    }
                  : item,
            ),
        );
      } catch (error) {
        setRows(
          (current) =>
            current.map(
              (item) =>
                item.rowNumber ===
                row.rowNumber
                  ? {
                      ...item,
                      status:
                        "FAILED",
                      resultMessage:
                        error instanceof
                        Error
                          ? error.message
                          : "Unable to save row.",
                    }
                  : item,
            ),
        );
      }
    }

    setSaving(false);

    if (
      successfullyPrepared.length
    ) {
      onPrepared(
        successfullyPrepared,
      );
    }
  }

  function clearSensitiveFields() {
    setRows(
      (current) =>
        current.map(
          (row) => ({
            ...row,
            email: "",
            password: "",
            twoFactorSecret: "",
            proxyUsername: "",
            proxyPassword: "",
          }),
        ),
    );

    setRawInput("");
  }

  return (
    <section className={styles.wrapper}>
      <button
        className={styles.toggleButton}
        type="button"
        onClick={() =>
          setOpen(
            (current) =>
              !current,
          )
        }
      >
        <span>
          Bulk Login Import
        </span>

        <span>
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div className={styles.content}>
          <div className={styles.intro}>
            <div>
              <h2>
                Paste from Excel
              </h2>

              <p>
                Copy rows directly from Excel or Google Sheets.
                Login credentials remain only in this browser tab
                and are not saved to Atlas.
              </p>
            </div>

            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                setRawInput(
                  TEMPLATE,
                )
              }
            >
              Load template
            </button>
          </div>

          <label className={styles.inputLabel}>
            <span>
              Excel / CSV data
            </span>

            <textarea
              value={rawInput}
              onChange={(event) =>
                setRawInput(
                  event.target.value,
                )
              }
              placeholder={TEMPLATE}
              rows={8}
              spellCheck={false}
            />
          </label>

          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={parseInput}
            >
              Parse & Validate
            </button>

            <button
              className={styles.secondaryButton}
              type="button"
              onClick={
                clearSensitiveFields
              }
            >
              Clear sensitive data
            </button>
          </div>

          {parsingError ? (
            <div className={styles.error}>
              {parsingError}
            </div>
          ) : null}

          {rows.length ? (
            <>
              <div className={styles.tableToolbar}>
                <div>
                  <strong>
                    {rows.length} rows
                  </strong>

                  <span>
                    {selectedCount} selected
                  </span>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={
                      selectAllReady
                    }
                  >
                    Select valid
                  </button>

                  <button
                    type="button"
                    onClick={
                      clearSelection
                    }
                  >
                    Clear selection
                  </button>
                </div>
              </div>

              <div className={styles.tableScroll}>
                <div
                  className={styles.table}
                  role="table"
                >
                  <div
                    className={styles.tableHeader}
                    role="row"
                  >
                    <span role="columnheader">
                      Select
                    </span>
                    <span role="columnheader">
                      Row
                    </span>
                    <span role="columnheader">
                      Account
                    </span>
                    <span role="columnheader">
                      Matched Channel
                    </span>
                    <span role="columnheader">
                      Email
                    </span>
                    <span role="columnheader">
                      Proxy
                    </span>
                    <span role="columnheader">
                      Country
                    </span>
                    <span role="columnheader">
                      Validation
                    </span>
                    <span role="columnheader">
                      Result
                    </span>
                  </div>

                  {rows.map(
                    (row) => (
                      <div
                        className={styles.tableRow}
                        role="row"
                        key={row.rowNumber}
                      >
                        <span role="cell">
                          <input
                            type="checkbox"
                            checked={selectedRows.has(
                              row.rowNumber,
                            )}
                            disabled={
                              row.status ===
                              "INVALID"
                            }
                            onChange={() =>
                              toggleRow(
                                row.rowNumber,
                              )
                            }
                          />
                        </span>

                        <span role="cell">
                          {row.rowNumber}
                        </span>

                        <strong role="cell">
                          {row.accountName ||
                            "—"}
                        </strong>

                        <span role="cell">
                          {row.matchedChannelName ||
                            "Not found"}
                        </span>

                        <span
                          className={styles.maskedCell}
                          role="cell"
                        >
                          {row.email
                            ? row.email.replace(
                                /(.{2}).+(@.*)/,
                                "$1••••$2",
                              )
                            : "—"}
                        </span>

                        <span role="cell">
                          {row.proxyType ===
                          "DIRECT"
                            ? "DIRECT"
                            : `${row.proxyType} · ${row.proxyHost}:${row.proxyPort}`}
                        </span>

                        <span role="cell">
                          {row.proxyCountry ||
                            "—"}
                        </span>

                        <span role="cell">
                          <span
                            className={[
                              styles.status,
                              row.status ===
                                "INVALID" ||
                              row.status ===
                                "FAILED"
                                ? styles.bad
                                : row.status ===
                                    "SAVED"
                                  ? styles.good
                                  : styles.neutral,
                            ].join(" ")}
                          >
                            {row.status}
                          </span>

                          {row.errors.length ? (
                            <small>
                              {row.errors.join(
                                " ",
                              )}
                            </small>
                          ) : null}
                        </span>

                        <span role="cell">
                          {row.resultMessage ||
                            "—"}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>

              <div className={styles.footer}>
                <p>
                  Password and 2FA fields are not sent during profile
                  preparation. They remain in temporary local state only.
                </p>

                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={
                    saving ||
                    readySelectedRows.length ===
                      0
                  }
                  onClick={() =>
                    void prepareSelected()
                  }
                >
                  {saving
                    ? "Preparing…"
                    : `Prepare ${readySelectedRows.length} accounts`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
