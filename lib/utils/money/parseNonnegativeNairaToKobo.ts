export function parseNonnegativeNairaToKobo(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a valid naira amount with at most two decimal places.');
  const kobo = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(kobo) || kobo < 0) {
    throw new Error('Enter a non-negative amount within the supported range.');
  }
  return kobo;
}
