'use client';

type CsrfResponse = {
  csrfToken: string;
};

async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf', {
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('Unable to prepare a secure authentication request.');
  }

  const responseBody = (await response.json()) as Partial<CsrfResponse>;

  if (!responseBody.csrfToken) {
    throw new Error('Unable to prepare a secure authentication request.');
  }

  return responseBody.csrfToken;
}

export async function createServerSession(idToken: string) {
  const csrfToken = await getCsrfToken();
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    throw new Error('Unable to establish a secure session.');
  }
}

export async function deleteServerSession() {
  const csrfToken = await getCsrfToken();
  const response = await fetch('/api/auth/session', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {
      'X-CSRF-Token': csrfToken,
    },
  });

  if (!response.ok) {
    throw new Error('Unable to end the session safely.');
  }
}
