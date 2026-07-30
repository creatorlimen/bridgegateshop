import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  PermissionRequiredError,
  requireStaffPermission,
  StaffAccessRequiredError,
} from '@/lib/auth/authorization';
import {
  CatalogueMediaService,
} from '@/lib/services/catalogue/CatalogueMediaService';
import {
  CatalogueMutationError,
} from '@/lib/services/catalogue/CatalogueMutationService';
import { createCatalogueUploadIntentInputSchema } from '@/lib/schemas/mediaUpload';
import { requestHasValidMutationProtection } from '@/lib/security/mutationRequest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return NextResponse.json(
    { ok: false, code, message, requestId },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  try {
    if (!requestHasValidMutationProtection(request)) {
      return errorResponse(
        403,
        'REQUEST_REJECTED',
        'Request rejected.',
        requestId,
      );
    }

    const staffContext = await requireStaffPermission('catalogue.write');
    const requestBody: unknown = await request.json();
    const parsedRequest =
      createCatalogueUploadIntentInputSchema.safeParse(requestBody);

    if (!parsedRequest.success) {
      return errorResponse(
        400,
        'VALIDATION_FAILED',
        'The image upload request is invalid.',
        requestId,
      );
    }

    const uploadIntent =
      await new CatalogueMediaService().createUploadIntent(
        parsedRequest.data,
        {
          actorId: staffContext.session.uid,
          roleIds: staffContext.membership.roleIds,
          requestId,
        },
      );

    return NextResponse.json(
      {
        ok: true,
        data: uploadIntent,
        requestId,
      },
      {
        status: 201,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    if (error instanceof StaffAccessRequiredError) {
      return errorResponse(
        401,
        'AUTH_REQUIRED',
        'An active staff session is required.',
        requestId,
      );
    }

    if (error instanceof PermissionRequiredError) {
      return errorResponse(
        403,
        'PERMISSION_DENIED',
        'Your staff role cannot upload catalogue media.',
        requestId,
      );
    }

    if (error instanceof CatalogueMutationError) {
      return errorResponse(
        error.code === 'NOT_FOUND' ? 404 : 409,
        error.code,
        error.message,
        requestId,
      );
    }

    console.error({
      eventName: 'catalogue.media.uploadIntent.failed',
      requestId,
      safeErrorCode: 'INTERNAL_ERROR',
    });

    return errorResponse(
      500,
      'INTERNAL_ERROR',
      'The image upload could not be started.',
      requestId,
    );
  }
}
