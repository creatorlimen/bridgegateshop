import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { loadCheckoutSettings } from '@/lib/config/checkoutSettings';
import { createTransferEvidenceIntentInputSchema } from '@/lib/schemas/transferEvidenceUpload';
import { requestHasValidMutationProtection } from '@/lib/security/mutationRequest';
import { getOrderAccessProof } from '@/lib/services/carts/cartSession';
import { createTransferEvidenceService, TransferEvidenceError } from '@/lib/services/payments/TransferEvidenceService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!requestHasValidMutationProtection(request)) return NextResponse.json({ ok: false, message: 'Request rejected.', requestId }, { status: 403 });
  const proof = await getOrderAccessProof();
  if (!proof) return NextResponse.json({ ok: false, message: 'Order access is required.', requestId }, { status: 401 });
  const parsed = createTransferEvidenceIntentInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false, message: 'Evidence upload request is invalid.', requestId }, { status: 400 });
  try {
    const settings = await loadCheckoutSettings();
    const data = await createTransferEvidenceService(undefined, undefined, settings).createIntent(parsed.data, proof);
    return NextResponse.json({ ok: true, data, requestId }, { status: 201 });
  } catch (error) {
    const status = error instanceof TransferEvidenceError && error.code === 'PERMISSION_DENIED' ? 403 : 409;
    return NextResponse.json({ ok: false, message: error instanceof TransferEvidenceError ? error.message : 'Evidence upload could not start.', requestId }, { status });
  }
}
