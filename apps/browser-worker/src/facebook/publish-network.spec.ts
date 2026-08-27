import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import {
  hasFacebookPublishNetworkError,
  startFacebookPublishNetworkCapture,
} from "./publish-network.js";

function createFakePage() {
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  return {
    page: {
      on(event: string, listener: (value: unknown) => void) {
        const eventListeners = listeners.get(event) || new Set();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
      },
      off(event: string, listener: (value: unknown) => void) {
        listeners.get(event)?.delete(listener);
      },
    } as unknown as Page,
    emit(event: string, value: unknown) {
      listeners.get(event)?.forEach((listener) => listener(value));
    },
  };
}

test("captures Facebook POST response status without query parameters", async () => {
  const fake = createFakePage();
  const capture = startFacebookPublishNetworkCapture(fake.page);

  fake.emit("response", {
    url: () => "https://www.facebook.com/api/graphql/?token=secret",
    status: () => 403,
    text: async () => '{"error":"permission denied"}',
    request: () => ({
      method: () => "POST",
      url: () => "https://www.facebook.com/api/graphql/?token=secret",
      resourceType: () => "fetch",
      postData: () => null,
    }),
  });

  const events = await capture.stop();

  assert.deepEqual(events, [
    {
      kind: "response",
      method: "POST",
      path: "/api/graphql/",
      status: 403,
      resourceType: "fetch",
      errorHint: "HTTP_403",
      operationName: null,
      postDataKeys: [],
    },
  ]);
});

test("does not wait forever for a Facebook response body", async () => {
  const fake = createFakePage();
  const capture = startFacebookPublishNetworkCapture(fake.page, 10);

  fake.emit("response", {
    url: () => "https://www.facebook.com/api/graphql/",
    status: () => 200,
    text: () => new Promise<string>(() => undefined),
    request: () => ({
      method: () => "POST",
      url: () => "https://www.facebook.com/api/graphql/",
      resourceType: () => "xhr",
      postData: () => null,
    }),
  });

  const events = await capture.stop();

  assert.deepEqual(events, [
    {
      kind: "response",
      method: "POST",
      path: "/api/graphql/",
      status: 200,
      resourceType: "xhr",
      errorHint: null,
      operationName: null,
      postDataKeys: [],
    },
  ]);
});

test("ignores non-Facebook and non-POST requests", async () => {
  const fake = createFakePage();
  const capture = startFacebookPublishNetworkCapture(fake.page);

  fake.emit("response", {
    url: () => "https://www.facebook.com/api/graphql/",
    status: () => 200,
    text: async () => "ok",
    request: () => ({
      method: () => "GET",
      url: () => "https://www.facebook.com/api/graphql/",
      resourceType: () => "fetch",
      postData: () => null,
    }),
  });
  fake.emit("response", {
    url: () => "https://example.com/api/graphql/",
    status: () => 200,
    text: async () => "ok",
    request: () => ({
      method: () => "POST",
      url: () => "https://example.com/api/graphql/",
      resourceType: () => "fetch",
      postData: () => null,
    }),
  });

  assert.deepEqual(await capture.stop(), []);
});

test("treats a blocked Facebook response as a publish error", () => {
  assert.equal(
    hasFacebookPublishNetworkError([
      {
        kind: "response",
        method: "POST",
        path: "/api/graphql/",
        status: 200,
        resourceType: "xhr",
        errorHint: "blocked",
        friendlyName: "ComposerStoryCreateMutation",
        postDataKeys: [
          "doc_id",
          "fb_api_req_friendly_name",
          "variables",
        ],
      },
    ]),
    true,
  );
  assert.equal(
    hasFacebookPublishNetworkError([
      {
        kind: "response",
        method: "POST",
        path: "/api/graphql/",
        status: 200,
        resourceType: "xhr",
        errorHint: null,
      },
    ]),
    false,
  );
});

test("ignores blocked background responses without publish metadata", () => {
  assert.equal(
    hasFacebookPublishNetworkError([
      {
        kind: "response",
        method: "POST",
        path: "/ajax/bulk-route-definitions/",
        status: 200,
        resourceType: "xhr",
        errorHint: "error",
        operationName: null,
        postDataKeys: ["__a", "fb_dtsg"],
      },
      {
        kind: "response",
        method: "POST",
        path: "/api/graphql/",
        status: 200,
        resourceType: "xhr",
        errorHint: "blocked",
        operationName: null,
        postDataKeys: ["__a", "fb_dtsg", "variables"],
      },
    ]),
    false,
  );
});

test("treats a blocked GraphQL publish request as a publish error", () => {
  assert.equal(
    hasFacebookPublishNetworkError([
      {
        kind: "response",
        method: "POST",
        path: "/api/graphql/",
        status: 200,
        resourceType: "xhr",
        errorHint: "blocked",
        friendlyName: "ComposerStoryCreateMutation",
        operationName: null,
        postDataKeys: [
          "doc_id",
          "fb_api_req_friendly_name",
          "variables",
        ],
      },
    ]),
    true,
  );
});

test("ignores blocked GraphQL background queries with doc ids", () => {
  assert.equal(
    hasFacebookPublishNetworkError([
      {
        kind: "response",
        method: "POST",
        path: "/api/graphql/",
        status: 200,
        resourceType: "xhr",
        errorHint: "blocked",
        friendlyName: "CometFeedStoriesQuery",
        operationName: null,
        postDataKeys: ["doc_id", "fb_api_req_friendly_name", "variables"],
      },
    ]),
    false,
  );
});
