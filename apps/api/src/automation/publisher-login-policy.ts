export function isFacebookLoginRequiredFailure(
  message: string,
  response: unknown,
) {
  const normalizedMessage = message.trim().toLowerCase();

  if (normalizedMessage === 'facebook login is required.') {
    return true;
  }

  if (!response || typeof response !== 'object') {
    return false;
  }

  const payload = response as Record<string, unknown>;

  if (payload.loginRequired === true) {
    return true;
  }

  const loginPageText = [
    normalizedMessage,
    JSON.stringify(response).toLowerCase(),
  ].join(" ");

  if (
    loginPageText.includes("email or phone number") &&
    loginPageText.includes("password") &&
    loginPageText.includes("log in")
  ) {
    return true;
  }

  const workerResponse = payload.workerResponse;

  if (
    workerResponse &&
    typeof workerResponse === 'object' &&
    (workerResponse as Record<string, unknown>).loginRequired === true
  ) {
    return true;
  }

  // Facebook can return its login page while the worker is trying to open
  // the composer. In that case the worker reports a generic trigger failure,
  // but retrying cannot succeed until the browser profile is authenticated.
  return false;
}
