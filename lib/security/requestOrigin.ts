import 'server-only';

export function requestHasTrustedOrigin(
  request: Request,
  applicationBaseUrl: string,
) {
  const originHeader = request.headers.get('origin');
  const refererHeader = request.headers.get('referer');

  try {
    const requestOrigin = originHeader
      ? new URL(originHeader).origin
      : refererHeader
        ? new URL(refererHeader).origin
        : undefined;

    return requestOrigin === new URL(applicationBaseUrl).origin;
  } catch {
    return false;
  }
}
