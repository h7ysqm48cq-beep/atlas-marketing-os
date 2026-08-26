import assert from "node:assert/strict";
import test from "node:test";
import * as publishedPost from "./published-post.js";
import {
  buildFacebookPublishedPostReference,
  createFacebookCaptionFingerprint,
  extractFacebookPageId,
  resolveFacebookPublishVerificationStatus,
} from "./published-post.js";

test("uses the first content line as the caption fingerprint", () => {
  assert.equal(
    createFacebookCaptionFingerprint(
      "🏢 M BUSINESS｜M STORY 016\n\n麦当劳的成功关键",
    ),
    "M BUSINESS｜M STORY 016",
  );
});

test("extracts a numeric Facebook page id", () => {
  assert.equal(
    extractFacebookPageId(
      "https://www.facebook.com/profile.php?id=61592884960509",
    ),
    "61592884960509",
  );
});

test("prefers a multi-image pcb set as the published post id", () => {
  assert.deepEqual(
    buildFacebookPublishedPostReference(
      "https://www.facebook.com/profile.php?id=61592884960509",
      [
        "/photo/?fbid=122112144357429498&set=pcb.122112144501429498",
        "/photo/?fbid=122112144327429498&set=pcb.122112144501429498",
      ],
    ),
    {
      pageId: "61592884960509",
      facebookPostId: "122112144501429498",
      externalPostId: "61592884960509_122112144501429498",
      postUrl:
        "https://www.facebook.com/permalink.php?story_fbid=122112144501429498&id=61592884960509",
      matchedBy: "photo-set",
    },
  );
});

test("supports text-only post permalinks", () => {
  assert.equal(
    buildFacebookPublishedPostReference(
      "https://www.facebook.com/61592884960509",
      ["/61592884960509/posts/122112144501429498/"],
    )?.externalPostId,
    "61592884960509_122112144501429498",
  );
});

test("confirms a publish when the new post reference is present", () => {
  assert.equal(
    resolveFacebookPublishVerificationStatus({
      errorSignal: false,
      successSignal: false,
      composerStillVisible: true,
      postReferenceFound: true,
    }),
    "CONFIRMED",
  );
});

test("keeps an unresolved visible composer unconfirmed", () => {
  assert.equal(
    resolveFacebookPublishVerificationStatus({
      errorSignal: false,
      successSignal: false,
      composerStillVisible: true,
      postReferenceFound: false,
    }),
    "UNCONFIRMED",
  );
});

test("does not let a post reference override an explicit publish error", () => {
  assert.equal(
    resolveFacebookPublishVerificationStatus({
      errorSignal: true,
      successSignal: false,
      composerStillVisible: true,
      postReferenceFound: true,
    }),
    "FAILED",
  );
});

test("reports published when a real post reference confirms the publish", () => {
  const resolveFacebookPublishedFlag =
    (
      publishedPost as typeof publishedPost & {
        resolveFacebookPublishedFlag?: (input: {
          errorSignal: boolean;
          successSignal: boolean;
          composerStillVisible: boolean;
          postReferenceFound: boolean;
        }) => boolean;
      }
    ).resolveFacebookPublishedFlag;

  assert.equal(
    resolveFacebookPublishedFlag?.({
      errorSignal: false,
      successSignal: false,
      composerStillVisible: true,
      postReferenceFound: true,
    }),
    true,
  );
});
