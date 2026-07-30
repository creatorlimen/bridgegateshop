import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCatalogueDataSource } from '@/lib/config/catalogueDataSource';
import { getFirebaseAdminStorage } from '@/lib/firebase/admin';
import { createCatalogueRepository } from '@/lib/repositories/catalogue/CatalogueRepository';
import { firestoreDocumentIdSchema } from '@/lib/schemas/common';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

const mediaKindSchema = z.enum(['thumbnail', 'card', 'detail', 'social']);

type CatalogueMediaRouteProps = {
  params: Promise<{
    mediaId: string;
  }>;
};

function notFoundResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Product image not found.',
    },
    {
      status: 404,
      headers: {
        'Cache-Control': 'public,max-age=60',
      },
    },
  );
}

export async function GET(
  request: Request,
  { params }: CatalogueMediaRouteProps,
) {
  if (getCatalogueDataSource() !== 'firestore') {
    return notFoundResponse();
  }

  const { mediaId } = await params;
  const parsedMediaId = firestoreDocumentIdSchema.safeParse(mediaId);
  const parsedKind = mediaKindSchema.safeParse(
    new URL(request.url).searchParams.get('kind') ?? 'card',
  );

  if (!parsedMediaId.success || !parsedKind.success) {
    return notFoundResponse();
  }

  const repository = createCatalogueRepository();
  const media = await repository.findReadyProductMediaById(
    parsedMediaId.data,
  );

  if (!media) {
    return notFoundResponse();
  }

  const product = await repository.findActiveProductById(media.productId);

  if (!product) {
    return notFoundResponse();
  }

  const derivative = media.derivatives.find(
    (candidate) => candidate.kind === parsedKind.data,
  );

  if (!derivative) {
    return notFoundResponse();
  }

  try {
    const [imageBuffer] = await getFirebaseAdminStorage()
      .bucket()
      .file(derivative.storageObjectPath)
      .download();

    return new Response(new Uint8Array(imageBuffer), {
      headers: {
        'Cache-Control':
          'public,max-age=86400,s-maxage=31536000,immutable',
        'Content-Length': String(imageBuffer.byteLength),
        'Content-Type': derivative.mimeType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return notFoundResponse();
  }
}
