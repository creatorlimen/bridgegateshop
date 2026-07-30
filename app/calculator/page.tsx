import type { Metadata } from 'next';

import { MaterialCalculator } from '@/app/components/calculator/MaterialCalculator';

export const metadata: Metadata = {
  title: 'Material calculator',
  description:
    'Estimate building finishing material quantities using dimensions, coverage, and wastage.',
};

export default function CalculatorPage() {
  return (
    <div className="shell py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow text-clay">Material calculator</p>
        <h1 className="display-type mt-5 text-balance text-5xl leading-[0.98] sm:text-6xl">
          Turn site dimensions into a clear estimate.
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          Use the same tested calculation module across this page and product
          flows. Coverage figures remain placeholders until Specta approves the
          product data.
        </p>
      </div>
      <div className="mt-10">
        <MaterialCalculator />
      </div>
    </div>
  );
}
