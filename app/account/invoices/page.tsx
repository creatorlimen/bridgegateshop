import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentSession } from '@/lib/auth/session';
import { createFinancialDocumentRepository } from '@/lib/repositories/payments/FinancialDocumentRepository';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = {
  title: 'My invoices and receipts',
  robots: { index: false, follow: false },
};

export default async function AccountInvoicesPage() {
  const session = await getCurrentSession({ checkRevoked: true });
  if (!session) redirect('/auth/sign-in');
  const documents = await createFinancialDocumentRepository().listForCustomer(
    session.uid,
  );

  return (
    <div className="shell py-12 sm:py-16">
      <p className="eyebrow">Secure account</p>
      <h1 className="display-type mt-4 text-5xl sm:text-6xl">
        Invoices and receipts
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
        These private PDFs are generated from the immutable order and payment
        snapshots captured when each document was issued.
      </p>
      <div className="mt-8 grid gap-4">
        {documents.map((document) => (
          <Link
            className="rounded-2xl border border-ink/10 bg-paper p-5 transition hover:border-ink/30"
            href={`/api/financial-documents/${document.id}`}
            key={document.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-black">{document.documentNumber}</p>
                <p className="mt-1 text-xs text-muted">
                  {document.orderReference} · {document.documentType}
                </p>
              </div>
              <p className="text-xl font-black">
                {formatMoney(document.amountKobo)}
              </p>
            </div>
          </Link>
        ))}
        {!documents.length ? (
          <div className="rounded-2xl bg-paper p-6 text-sm text-muted">
            No financial documents have been issued yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}
