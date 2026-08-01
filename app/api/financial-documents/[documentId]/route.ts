import { getActiveStaffContext } from '@/lib/auth/authorization';
import { createFinancialDocumentRepository } from '@/lib/repositories/payments/FinancialDocumentRepository';
import { getOrderAccessProof } from '@/lib/services/carts/cartSession';
import { renderFinancialDocumentPdf } from '@/lib/services/payments/renderFinancialDocumentPdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const [{ documentId }, accessProof, staffContext] = await Promise.all([
    context.params,
    getOrderAccessProof(),
    getActiveStaffContext(),
  ]);
  const staffCanRead = staffContext?.permissions.has('orders.read') ?? false;
  const document = await createFinancialDocumentRepository().getById(
    documentId,
    accessProof,
    staffCanRead,
  );

  if (!document) {
    return new Response('Financial document not found.', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const content = renderFinancialDocumentPdf(document);
  return new Response(content, {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `attachment; filename="${document.documentNumber}.pdf"`,
      'Content-Length': String(content.byteLength),
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
