import { isFacebookLoginRequiredFailure } from './publisher-login-policy';

describe('isFacebookLoginRequiredFailure', () => {
  it('recognizes the direct browser-worker error', () => {
    expect(
      isFacebookLoginRequiredFailure('Facebook login is required.', null),
    ).toBe(true);
  });

  it('recognizes the structured worker response', () => {
    expect(
      isFacebookLoginRequiredFailure('Request failed.', {
        workerResponse: { loginRequired: true },
      }),
    ).toBe(true);
  });

  it('does not downgrade an account for unrelated failures', () => {
    expect(
      isFacebookLoginRequiredFailure('Composer trigger was not found.', {
        workerResponse: { loginRequired: false },
      }),
    ).toBe(false);
  });

  it('recognizes a composer failure caused by a Facebook login page', () => {
    expect(
      isFacebookLoginRequiredFailure(
        'Facebook composer trigger was not found after 30 attempts.',
        {
          workerResponse: {
            message:
              'Page text: Log In Forgot Account? Email or phone number Password Log In',
            loginRequired: false,
          },
        },
      ),
    ).toBe(true);
  });

  it('recognizes login-page text embedded in the worker error message', () => {
    expect(
      isFacebookLoginRequiredFailure(
        'Facebook composer trigger was not found. Page text: M Story ... Email or phone number Password Log In',
        {
          workerResponse: {
            loginRequired: false,
          },
        },
      ),
    ).toBe(true);
  });
});
