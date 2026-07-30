export default function Loading() {
  return (
    <div className="shell py-12" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading page</span>
      <div className="h-4 w-28 animate-pulse rounded-full bg-ink/10" />
      <div className="mt-6 h-16 max-w-2xl animate-pulse rounded-2xl bg-ink/10" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((placeholderIndex) => (
          <div
            className="aspect-square animate-pulse rounded-[1.75rem] bg-ink/10"
            key={placeholderIndex}
          />
        ))}
      </div>
    </div>
  );
}
