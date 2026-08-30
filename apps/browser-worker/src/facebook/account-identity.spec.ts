import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectFacebookAccountIdentity,
  type FacebookIdentityTab,
} from "./account-identity.js";

function makeTab(input?: {
  profileName?: string | null;
  gotoError?: Error;
  readError?: Error;
}) {
  const visited: string[] = [];
  let closes = 0;

  const tab: FacebookIdentityTab = {
    goto: async (url) => {
      visited.push(url);

      if (input?.gotoError) {
        throw input.gotoError;
      }
    },

    readProfileName: async () => {
      if (input?.readError) {
        throw input.readError;
      }

      return input?.profileName ?? null;
    },

    close: async () => {
      closes += 1;
    },
  };

  return {
    tab,
    visited,
    get closes() {
      return closes;
    },
  };
}

test("uses Facebook c_user as the personal account id and reads the profile name", async () => {
  const fake = makeTab({
    profileName: "Dania Dani",
  });

  const result =
    await inspectFacebookAccountIdentity({
      getCookies: async () => [
        {
          name: "xs",
          value: "session-cookie",
        },
        {
          name: "c_user",
          value: "1234567890",
        },
      ],

      openTemporaryTab: async () => fake.tab,
    });

  assert.deepEqual(result, {
    facebookUserId: "1234567890",
    facebookUserName: "Dania Dani",
  });

  assert.deepEqual(fake.visited, [
    "https://www.facebook.com/profile.php?id=1234567890",
  ]);
});

test("always closes the temporary Facebook identity tab after success", async () => {
  const fake = makeTab({
    profileName: "Dania Dani",
  });

  await inspectFacebookAccountIdentity({
    getCookies: async () => [
      {
        name: "c_user",
        value: "1234567890",
      },
    ],

    openTemporaryTab: async () => fake.tab,
  });

  assert.equal(fake.closes, 1);
});

test("identity inspection failure is non-fatal and still closes the temporary tab", async () => {
  const fake = makeTab({
    readError: new Error("facebook profile DOM changed"),
  });

  const result =
    await inspectFacebookAccountIdentity({
      getCookies: async () => [
        {
          name: "c_user",
          value: "1234567890",
        },
      ],

      openTemporaryTab: async () => fake.tab,
    });

  assert.equal(result, null);
  assert.equal(fake.closes, 1);
});

test("does not open a temporary tab when Facebook c_user is unavailable", async () => {
  let opened = 0;

  const result =
    await inspectFacebookAccountIdentity({
      getCookies: async () => [
        {
          name: "xs",
          value: "session-cookie",
        },
      ],

      openTemporaryTab: async () => {
        opened += 1;
        return makeTab().tab;
      },
    });

  assert.equal(result, null);
  assert.equal(opened, 0);
});


test("returns Facebook c_user without opening a temporary tab when profile-name capture is disabled", async () => {
  let opened = 0;

  const result =
    await inspectFacebookAccountIdentity({
      getCookies: async () => [
        {
          name: "c_user",
          value: "1234567890",
        },
      ],

      captureProfileName: false,

      openTemporaryTab: async () => {
        opened += 1;

        return makeTab({
          profileName: "Should Not Be Read",
        }).tab;
      },
    });

  assert.deepEqual(result, {
    facebookUserId: "1234567890",
    facebookUserName: null,
  });

  assert.equal(opened, 0);
});
