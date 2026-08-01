import Link from 'next/link';

import { createTransferEvidenceRepository } from '@/lib/repositories/payments/TransferEvidenceRepository';

export async function TransferEvidenceAdminList({ orderId }: { orderId: string }) {
  const evidence = await createTransferEvidenceRepository().listForOrder(orderId);
  if (!evidence.length) return null;
  return (
    <div className="mt-4 border-t border-ink/10 pt-4">
      <p className="text-sm font-black">Private transfer evidence</p>
      <div className="mt-3 grid gap-2">
        {evidence.map((item) => (
          <Link className="text-xs font-black underline" href={`/api/transfer-evidence/${item.id}`} key={item.id}>
            {item.originalFileName} · {item.id}
          </Link>
        ))}
      </div>
    </div>
  );
}
