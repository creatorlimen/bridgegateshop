import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import {
  PermissionRequiredError,
  requireStaffPermission,
  StaffAccessRequiredError,
} from '@/lib/auth/authorization';
import { finaliseCatalogueUploadInputSchema } from '@/lib/schemas/mediaUpload';
import { requestHasValidMutationProtection } from '@/lib/security/mutationRequest';
import { CatalogueMediaService } from '@/lib/services/catalogue/CatalogueMediaService';
import { CatalogueMutationError } from '@/lib/services/catalogue/CatalogueMutationService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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
      finaliseCatalogueUploadInputSchema.safeParse(requestBody);

    if (!parsedRequest.success) {
      return errorResponse(
        400,
        'VALIDATION_FAILED',
        'The upload finalisation request is invalid.',
        requestId,
      );
    }

    const finalisedUpload =
      await new CatalogueMediaService().finaliseUpload(
        parsedRequest.data,
        {
          actorId: staffContext.session.uid,
          roleIds: staffContext.membership.roleIds,
          requestId,
        },
      );

    revalidatePath('/');
    revalidatePath('/shop');
    revalidatePath('/admin/catalogue');

    return NextResponse.json(
      {
        ok: true,
        data: finalisedUpload,
        requestId,
      },
      {
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
        'Your staff role cannot finalise catalogue media.',
        requestId,
      );
    }

    if (error instanceof CatalogueMutationError) {
      const status =
        error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'VALIDATION_FAILED'
            ? 400
            : 409;

      return errorResponse(
        status,
        error.code,
        error.message,
        requestId,
      );
    }

    console.error({
      eventName: 'catalogue.media.finalise.failed',
      requestId,
      safeErrorCode: 'INTERNAL_ERROR',
    });

    return errorResponse(
      500,
      'INTERNAL_ERROR',
      'The image upload could not be finalised.',
      requestId,
    );
  }
}
