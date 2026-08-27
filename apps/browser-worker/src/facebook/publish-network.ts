import type {
  Page,
  Request,
  Response,
} from "playwright-core";

export type FacebookPublishNetworkEvent = {
  kind: "response" | "requestfailed";
  method: string;
  path: string;
  status?: number;
  resourceType?: string;
  errorHint?: string | null;
  operationName?: string | null;
  postDataKeys?: string[];
};

const facebookPublishErrorHints = [
  /checkpoint/i,
  /permission/i,
  /not allowed/i,
  /blocked/i,
  /couldn['’]?t/i,
  /could not/i,
  /failed/i,
  /error/i,
  /try again/i,
  /temporarily/i,
  /rate limit/i,
  /spam/i,
  /review/i,
];

function facebookPath(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname !== "facebook.com" &&
      hostname !== "www.facebook.com" &&
      !hostname.endsWith(".facebook.com")
    ) {
      return null;
    }

    return parsed.pathname || "/";
  } catch {
    return null;
  }
}

function isFacebookPublishRequest(request: Request) {
  return request.method().toUpperCase() === "POST" && Boolean(facebookPath(request.url()));
}

function findErrorHint(value: string) {
  const normalized = value.replace(/\s+/g, " ").slice(0, 12000);
  const pattern = facebookPublishErrorHints.find((candidate) => candidate.test(normalized));

  return pattern?.source || null;
}

function requestMetadata(request: Request) {
  const postData = request.postData() || "";

  if (!postData) {
    return {
      operationName: null,
      postDataKeys: [],
    };
  }

  try {
    const parsed = JSON.parse(postData) as Record<string, unknown>;

    return {
      operationName:
        typeof parsed.operationName === "string"
          ? parsed.operationName
          : null,
      postDataKeys: Object.keys(parsed).sort().slice(0, 30),
    };
  } catch {
    const parameters = new URLSearchParams(postData);

    return {
      operationName: parameters.get("operationName"),
      postDataKeys: Array.from(parameters.keys()).sort().slice(0, 30),
    };
  }
}

async function inspectResponse(response: Response) {
  const request = response.request();
  const metadata = requestMetadata(request);
  const event: FacebookPublishNetworkEvent = {
    kind: "response",
    method: request.method(),
    path: facebookPath(response.url()) || "/",
    status: response.status(),
    resourceType: request.resourceType(),
    errorHint: response.status() >= 400 ? `HTTP_${response.status()}` : null,
    ...metadata,
  };

  const body = await response.text().catch(() => "");

  event.errorHint =
    event.errorHint ||
    findErrorHint(body);

  return event;
}

export function startFacebookPublishNetworkCapture(page: Page) {
  const events: FacebookPublishNetworkEvent[] = [];
  const pendingInspections = new Set<Promise<void>>();
  let stopped = false;
  let stopPromise: Promise<FacebookPublishNetworkEvent[]> | null = null;

  const onResponse = (response: Response) => {
    if (stopped || !isFacebookPublishRequest(response.request())) {
      return;
    }

    const inspection: Promise<void> = inspectResponse(response)
      .then((event) => {
        if (events.length < 50) {
          events.push(event);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        pendingInspections.delete(inspection);
      });

    pendingInspections.add(inspection);
  };

  const onRequestFailed = (request: Request) => {
    if (stopped || !isFacebookPublishRequest(request)) {
      return;
    }

    if (events.length >= 50) {
      return;
    }

    events.push({
      kind: "requestfailed",
      method: request.method(),
      path: facebookPath(request.url()) || "/",
      resourceType: request.resourceType(),
      errorHint: request.failure()?.errorText || "REQUEST_FAILED",
      ...requestMetadata(request),
    });
  };

  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  return {
    events,
    stop: async () => {
      if (stopPromise) {
        return stopPromise;
      }

      stopped = true;
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);

      stopPromise = Promise.allSettled([...pendingInspections]).then(() => events);
      return stopPromise;
    },
  };
}
