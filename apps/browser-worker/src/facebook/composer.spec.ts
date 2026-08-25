import assert from "node:assert/strict";
import test from "node:test";
import {
  countFacebookComposerImagePreviewCandidates,
  isFacebookComposerImagePreviewCandidate,
  normalizeFacebookComposerImagePreviewSource,
  type FacebookComposerImagePreviewCandidate,
} from "./composer.js";

const createCandidate = (
  overrides: Partial<FacebookComposerImagePreviewCandidate> = {},
): FacebookComposerImagePreviewCandidate => ({
  tagName: "IMG",
  role: null,
  sourceType: "IMG",
  source: "blob:https://www.facebook.com/upload-preview",
  display: "block",
  visibility: "visible",
  opacity: 1,
  width: 640,
  height: 640,
  naturalWidth: 1200,
  naturalHeight: 1200,
  ...overrides,
});

test("accepts a visible large Facebook img preview", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate(),
    ),
    true,
  );
});

test("accepts a visible Facebook background-image preview", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        tagName: "DIV",
        role: "img",
        sourceType: "BACKGROUND",
        source:
          'url("blob:https://www.facebook.com/background-preview")',
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ),
    true,
  );
});

test("rejects small avatars and emoji images", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        width: 40,
        height: 40,
      }),
    ),
    false,
  );
});

test("rejects hidden or transparent candidates", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        display: "none",
      }),
    ),
    false,
  );
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        opacity: 0,
      }),
    ),
    false,
  );
});

test("rejects unloaded and broken img candidates", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ),
    false,
  );
});

test("normalizes CSS url preview sources", () => {
  assert.equal(
    normalizeFacebookComposerImagePreviewSource(
      'url("blob:https://www.facebook.com/preview")',
    ),
    "blob:https://www.facebook.com/preview",
  );
});

test("counts one upload once when img and background wrappers share a source", () => {
  assert.equal(
    countFacebookComposerImagePreviewCandidates([
      createCandidate({
        source:
          "blob:https://www.facebook.com/shared-preview",
      }),
      createCandidate({
        tagName: "DIV",
        role: "img",
        sourceType: "BACKGROUND",
        source:
          'url("blob:https://www.facebook.com/shared-preview")',
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ]),
    1,
  );
});
