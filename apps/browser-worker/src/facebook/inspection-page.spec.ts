import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFacebookInspectionTab,
  selectFacebookInspectionTab,
} from "./inspection-page.js";

test("prefers the latest logged-in Facebook tab over a later login tab", () => {
  assert.equal(
    selectFacebookInspectionTab([
      {
        url: "https://www.facebook.com/profile.php?id=61593075140209",
        loginRequired: false,
      },
      {
        url: "https://www.facebook.com/login/",
        loginRequired: true,
      },
    ]),
    0,
  );
});

test("prefers the latest ready Facebook tab when unrelated tabs exist", () => {
  assert.equal(
    selectFacebookInspectionTab([
      {
        url: "https://www.facebook.com/login/",
        loginRequired: true,
      },
      {
        url: "https://example.com/",
        loginRequired: false,
      },
      {
        url: "https://www.facebook.com/pages/?category=your_pages",
        loginRequired: false,
      },
    ]),
    2,
  );
});

test("does not treat a Facebook login challenge as a ready tab", () => {
  assert.deepEqual(
    classifyFacebookInspectionTab({
      url: "https://www.facebook.com/checkpoint/",
      text: "Confirm your identity",
      hasVisiblePassword: false,
    }),
    {
      facebook: true,
      loginRequired: false,
      challenge: true,
      ready: false,
    },
  );
});
