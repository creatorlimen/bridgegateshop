export type DomainErrorCode =
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'PROVIDER_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export type ActionResult<Data> =
  | {
      ok: true;
      data: Data;
      requestId: string;
    }
  | {
      ok: false;
      code: DomainErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
      requestId: string;
    };
