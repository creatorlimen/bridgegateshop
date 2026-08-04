export function withoutDocumentId<TRecord extends { id: string }>(
  record: TRecord,
): Omit<TRecord, 'id'> {
  const { id, ...document } = record;
  void id;
  return document;
}
