import 'server-only';

import type { FinancialDocumentRecord } from '@/lib/schemas/financial';
import { formatMoney } from '@/lib/utils/money/formatMoney';

function escapePdfText(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(value: string, width = 78) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderFinancialDocumentPdf(document: FinancialDocumentRecord) {
  const title =
    document.documentType === 'invoice'
      ? 'INVOICE'
      : document.documentType === 'receipt'
        ? 'PAYMENT RECEIPT'
        : 'REFUND CREDIT NOTE';
  const textLines = [
    document.business.name,
    document.business.address,
    `${document.business.email} | ${document.business.phone}`,
    '',
    `${title}  ${document.documentNumber}`,
    `Order: ${document.orderReference}`,
    `Issued: ${document.issuedAtIso}`,
    '',
    `Customer: ${document.customer.fullName}`,
    `${document.customer.email} | ${document.customer.phone}`,
    `Fulfilment: ${document.fulfilment.label}`,
    '',
    ...document.lines.flatMap((line) =>
      wrapText(
        `${line.quantity} x ${line.description} [${line.sku}]  ${formatMoney(line.lineTotalKobo)}`,
      ),
    ),
    '',
    `Subtotal: ${formatMoney(document.totals.subtotalKobo)}`,
    `Delivery: ${formatMoney(document.totals.deliveryKobo)}`,
    `Discount: ${formatMoney(document.totals.discountKobo)}`,
    `Tax treatment: Not configured`,
    `Order total: ${formatMoney(document.totals.grandTotalKobo)}`,
    `Document amount: ${formatMoney(document.amountKobo)}`,
    `Paid to date: ${formatMoney(document.totals.amountPaidKobo)}`,
    `Outstanding: ${formatMoney(document.totals.amountOutstandingKobo)}`,
    `Refunded: ${formatMoney(document.totals.refundTotalKobo)}`,
    '',
    `Integrity checksum: ${document.contentHash}`,
  ];
  const commands = [
    'BT',
    '/F1 11 Tf',
    '48 790 Td',
    '14 TL',
    ...textLines.flatMap((line) => [
      `(${escapePdfText(line)}) Tj`,
      'T*',
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(commands, 'ascii')} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output, 'ascii'));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'ascii');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(output, 'ascii');
}
