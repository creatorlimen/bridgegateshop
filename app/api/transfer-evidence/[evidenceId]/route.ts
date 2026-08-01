import { getActiveStaffContext } from '@/lib/auth/authorization';
import { getFirebaseAdminStorage } from '@/lib/firebase/admin';
import { createTransferEvidenceRepository } from '@/lib/repositories/payments/TransferEvidenceRepository';
import { getOrderAccessProof } from '@/lib/services/carts/cartSession';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ evidenceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const [{ evidenceId }, proof, staff] = await Promise.all([
    context.params,
    getOrderAccessProof(),
    getActiveStaffContext(),
  ]);
  const evidence = await createTransferEvidenceRepository().getById(
    evidenceId,
    proof,
    staff?.permissions.has('payments.record') ?? false,
  );
  if (!evidence) return new Response('Evidence not found.', { status: 404 });
  const [content] = await getFirebaseAdminStorage()
    .bucket()
    .file(evidence.storageObjectPath)
    .download();
  const safeName = evidence.originalFileName.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(Uint8Array.from(content), {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': String(content.byteLength),
      'Content-Type': evidence.mimeType,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
