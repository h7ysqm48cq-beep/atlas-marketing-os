import express from "express";
import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { Duplex } from "node:stream";
import net from "node:net";


function normalizePort(
  value: string | undefined,
  fallback: number,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 65535
  ) {
    return fallback;
  }

  return parsed;
}


function safeEqual(
  left: string,
  right: string,
) {
  const leftBuffer =
    Buffer.from(left);

  const rightBuffer =
    Buffer.from(right);

  if (
    leftBuffer.length !==
    rightBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    leftBuffer,
    rightBuffer,
  );
}


function verifyViewerToken(
  token: string | null,
  secret: string,
) {
  if (!token) {
    return false;
  }

  const parts =
    token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [
    expiresRaw,
    nonce,
    suppliedSignature,
  ] = parts;

  if (
    !expiresRaw ||
    !nonce ||
    !suppliedSignature
  ) {
    return false;
  }

  const expiresAt =
    Number(expiresRaw);

  if (
    !Number.isInteger(
      expiresAt,
    )
  ) {
    return false;
  }

  const now =
    Math.floor(
      Date.now() / 1000,
    );

  /*
   * Token must still be alive.
   * Also reject absurdly long-lived tokens.
   */
  if (
    expiresAt <= now ||
    expiresAt >
      now + 15 * 60
  ) {
    return false;
  }

  const payload =
    `${expiresRaw}.${nonce}`;

  const expectedSignature =
    createHmac(
      "sha256",
      secret,
    )
      .update(payload)
      .digest("base64url");

  return safeEqual(
    suppliedSignature,
    expectedSignature,
  );
}


function rejectUpgrade(
  socket: Duplex,
  status:
    | 401
    | 404
    | 502,
  message: string,
) {
  const body =
    Buffer.from(message);

  const statusText =
    status === 401
      ? "Unauthorized"
      : status === 404
        ? "Not Found"
        : "Bad Gateway";

  socket.write(
    [
      `HTTP/1.1 ${status} ${statusText}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${body.length}`,
      "",
      "",
    ].join("\r\n"),
  );

  socket.write(body);
  socket.destroy();
}


export function startSecureViewerServer() {
  const viewerPort =
    normalizePort(
      process.env.NOVNC_PORT,
      6080,
    );

  const internalPort =
    normalizePort(
      process.env.NOVNC_INTERNAL_PORT,
      6081,
    );

  const viewerTokenSecret =
    process.env
      .BROWSER_VIEWER_TOKEN_SECRET
      ?.trim();

  if (!viewerTokenSecret) {
    throw new Error(
      "BROWSER_VIEWER_TOKEN_SECRET is required.",
    );
  }

  const viewerApp =
    express();

  viewerApp.disable(
    "x-powered-by",
  );

  viewerApp.get(
    "/viewer-health",
    (_request, response) => {
      response.json({
        ok: true,
        secureViewer: true,
      });
    },
  );

  /*
   * noVNC static UI can be public.
   * The actual websocket connection below
   * requires a signed short-lived token.
   */
  viewerApp.use(
    express.static(
      "/usr/share/novnc",
      {
        index: false,
        maxAge: "1h",
      },
    ),
  );

  viewerApp.get(
    "/",
    (_request, response) => {
      response.redirect(
        "/vnc.html",
      );
    },
  );

  const server =
    viewerApp.listen(
      viewerPort,
      "::",
      () => {
        console.log(
          `Secure noVNC viewer listening on port ${viewerPort}`,
        );
      },
    );

  server.on(
    "upgrade",
    (
      request,
      socket,
      head,
    ) => {
      let requestUrl: URL;

      try {
        requestUrl =
          new URL(
            request.url || "/",
            "http://localhost",
          );
      } catch {
        rejectUpgrade(
          socket,
          404,
          "Invalid viewer request.",
        );

        return;
      }

      if (
        requestUrl.pathname !==
        "/websockify"
      ) {
        rejectUpgrade(
          socket,
          404,
          "Viewer websocket route not found.",
        );

        return;
      }

      const token =
        requestUrl.searchParams.get(
          "token",
        );

      if (
        !verifyViewerToken(
          token,
          viewerTokenSecret,
        )
      ) {
        rejectUpgrade(
          socket,
          401,
          "Viewer token is invalid or expired.",
        );

        return;
      }

      /*
       * Token is consumed at the public edge.
       * Only the clean websocket request is
       * forwarded to local websockify.
       */
      const upstream =
        net.connect(
          {
            host:
              "127.0.0.1",
            port:
              internalPort,
          },
        );

      upstream.setNoDelay(
        true,
      );

      upstream.once(
        "connect",
        () => {
          const headerLines:
            string[] = [];

          for (
            let index = 0;
            index <
              request.rawHeaders.length;
            index += 2
          ) {
            const name =
              request.rawHeaders[
                index
              ];

            const value =
              request.rawHeaders[
                index + 1
              ];

            if (
              !name ||
              value === undefined
            ) {
              continue;
            }

            if (
              name.toLowerCase() ===
              "host"
            ) {
              headerLines.push(
                `Host: 127.0.0.1:${internalPort}`,
              );

              continue;
            }

            headerLines.push(
              `${name}: ${value}`,
            );
          }

          upstream.write(
            [
              "GET /websockify HTTP/1.1",
              ...headerLines,
              "",
              "",
            ].join("\r\n"),
          );

          if (
            head.length > 0
          ) {
            upstream.write(
              head,
            );
          }

          socket.pipe(
            upstream,
          );

          upstream.pipe(
            socket,
          );
        },
      );

      upstream.once(
        "error",
        () => {
          if (
            !socket.destroyed
          ) {
            rejectUpgrade(
              socket,
              502,
              "Internal noVNC websocket is unavailable.",
            );
          }
        },
      );

      socket.once(
        "error",
        () => {
          upstream.destroy();
        },
      );

      socket.once(
        "close",
        () => {
          upstream.destroy();
        },
      );
    },
  );

  return server;
}
