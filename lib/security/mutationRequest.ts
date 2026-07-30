import 'server-only';

import { getServerEnvironment } from '@/lib/config/serverEnvironment';
import { csrfCookieName, csrfTokenMatches } from '@/lib/security/csrf';
import { requestHasTrustedOrigin } from '@/lib/security/requestOrigin';

function getCookieValue(request: Request, cookieName: string) {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((cookiePart) => cookiePart.trim())
    .find((cookiePart) => cookiePart.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

export function requestHasValidMutationProtection(request: Request) {
  const serverEnvironment = getServerEnvironment();

  return (
    requestHasTrustedOrigin(request, serverEnvironment.appBaseUrl) &&
    csrfTokenMatches(
      request.headers.get('x-csrf-token'),
      getCookieValue(request, csrfCookieName),
    )
  );
}
