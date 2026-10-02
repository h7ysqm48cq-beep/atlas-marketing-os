import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectFacebookAccountIdentity,
  normalizeFacebookProfileName,
} from "./account-identity.js";

test(
  "normalizeFacebookProfileName rejects generic Facebook chrome titles",
  () => {
    assert.equal(
      normalizeFacebookProfileName("Facebook"),
      null,
    );

    assert.equal(
      normalizeFacebookProfileName("(20+) Facebook"),
      null,
    );

    assert.equal(
      normalizeFacebookProfileName(" Notifications "),
      null,
    );
  },
);

test(
  "normalizeFacebookProfileName keeps credible profile names",
  () => {
    assert.equal(
      normalizeFacebookProfileName("Judy Vin"),
      "Judy Vin",
    );

    assert.equal(
      normalizeFacebookProfileName(
        "  Bong   Lai   Weng  ",
      ),
      "Bong Lai Weng",
    );
  },
);

test(
  "identity inspection preserves c_user when profile name is generic",
  async () => {
    const identity =
      await inspectFacebookAccountIdentity({
        getCookies: async () => [
          {
            name: "c_user",
            value: "61588968322086",
          },
        ],
        openTemporaryTab: async () => ({
          goto: async () => {},
          readProfileName: async () =>
            "(20+) Facebook",
          close: async () => {},
        }),
      });

    assert.deepEqual(
      identity,
      {
        facebookUserId:
          "61588968322086",
        facebookUserName: null,
      },
    );
  },
);

test(
  "retries profile-name capture after generic Facebook chrome text",
  async () => {
    let profileNameReads = 0;

    const identity =
      await inspectFacebookAccountIdentity({
        getCookies: async () => [
          {
            name: "c_user",
            value: "1234567890",
          },
        ],

        openTemporaryTab: async () => ({
          goto: async () => {},

          readProfileName: async () => {
            profileNameReads += 1;

            return profileNameReads === 1
              ? "(20+) Facebook"
              : "Example Person";
          },

          close: async () => {},
        }),
      });

    assert.deepEqual(
      identity,
      {
        facebookUserId: "1234567890",
        facebookUserName: "Example Person",
      },
    );

    assert.equal(
      profileNameReads,
      2,
    );
  },
);
