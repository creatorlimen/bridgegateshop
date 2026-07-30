'use client';

import { useMemo, useState } from 'react';
import { Calculator, Plus, Ruler } from 'lucide-react';

import { addCartItemAction } from '@/app/actions/cart';
import type { Product } from '@/lib/types/catalogue';
import { calculateMaterials } from '@/lib/utils/calculator/calculateMaterials';
import { formatMoney } from '@/lib/utils/money/formatMoney';


export function MaterialCalculator({
  products,
}: {
  products: Product[];
}) {
  const calculatorVariants = useMemo(
    () =>
      products.flatMap((product) =>
        product.variants
          .filter((variant) => variant.coverageSquareMetres)
          .map((variant) => ({ productName: product.name, variant })),
      ),
    [products],
  );
  const [selectedVariantId, setSelectedVariantId] = useState(
    calculatorVariants[0]?.variant.id ?? '',
  );
  const [lengthMetres, setLengthMetres] = useState(5);
  const [widthOrHeightMetres, setWidthOrHeightMetres] = useState(3);
  const [wastagePercent, setWastagePercent] = useState(10);
  const selectedEntry = calculatorVariants.find(
    (entry) => entry.variant.id === selectedVariantId,
  );

  const calculationResult = useMemo(() => {
    if (!selectedEntry?.variant.coverageSquareMetres) {
      return undefined;
    }

    try {
      return calculateMaterials({
        lengthMillimetres: Math.round(lengthMetres * 1000),
        widthOrHeightMillimetres: Math.round(widthOrHeightMetres * 1000),
        coverageSquareMetresPerUnit:
          selectedEntry.variant.coverageSquareMetres,
        wastageBasisPoints: Math.round(wastagePercent * 100),
        unitPriceKobo: selectedEntry.variant.priceKobo,
      });
    } catch {
      return undefined;
    }
  }, [
    lengthMetres,
    selectedEntry,
    wastagePercent,
    widthOrHeightMetres,
  ]);

  return (
    <div className="grid overflow-hidden rounded-[2rem] border border-ink/10 bg-paper shadow-card lg:grid-cols-[1fr_0.82fr]">
      <div className="p-6 sm:p-9">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber/20 text-clay">
            <Ruler aria-hidden="true" size={21} />
          </span>
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-muted">
              Surface details
            </p>
            <h2 className="font-black">Enter measurements in metres</h2>
          </div>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-black">
            Surface type
            <select className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal outline-none focus:border-ink">
              <option>Wall</option>
              <option>Ceiling</option>
              <option>Floor</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-black">
            Product and pack size
            <select
              className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal outline-none focus:border-ink"
              onChange={(event) => setSelectedVariantId(event.target.value)}
              value={selectedVariantId}
            >
              {calculatorVariants.map((entry) => (
                <option value={entry.variant.id} key={entry.variant.id}>
                  {entry.productName} · {entry.variant.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-black">
            Length
            <span className="flex min-h-12 items-center rounded-xl border border-ink/15 bg-canvas pr-4 focus-within:border-ink">
              <input
                className="min-w-0 flex-1 bg-transparent px-4 font-normal outline-none"
                min="0.1"
                onChange={(event) =>
                  setLengthMetres(Number(event.target.value))
                }
                step="0.1"
                type="number"
                value={lengthMetres}
              />
              <span className="text-xs font-bold text-muted">metres</span>
            </span>
          </label>
          <label className="grid gap-2 text-sm font-black">
            Width or height
            <span className="flex min-h-12 items-center rounded-xl border border-ink/15 bg-canvas pr-4 focus-within:border-ink">
              <input
                className="min-w-0 flex-1 bg-transparent px-4 font-normal outline-none"
                min="0.1"
                onChange={(event) =>
                  setWidthOrHeightMetres(Number(event.target.value))
                }
                step="0.1"
                type="number"
                value={widthOrHeightMetres}
              />
              <span className="text-xs font-bold text-muted">metres</span>
            </span>
          </label>
          <label className="grid gap-2 text-sm font-black sm:col-span-2">
            Wastage allowance
            <span className="flex min-h-12 items-center rounded-xl border border-ink/15 bg-canvas pr-4 focus-within:border-ink">
              <input
                className="min-w-0 flex-1 bg-transparent px-4 font-normal outline-none"
                max="50"
                min="0"
                onChange={(event) =>
                  setWastagePercent(Number(event.target.value))
                }
                step="1"
                type="number"
                value={wastagePercent}
              />
              <span className="text-xs font-bold text-muted">percent</span>
            </span>
          </label>
        </div>
      </div>

      <div className="paper-grid bg-ink p-6 text-white sm:p-9">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber text-ink">
            <Calculator aria-hidden="true" size={21} />
          </span>
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-white/45">
              Estimate
            </p>
            <h2 className="font-black">Material result</h2>
          </div>
        </div>

        {calculationResult && selectedEntry ? (
          <>
            <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl bg-white/10">
              <div className="bg-ink/80 p-5">
                <dt className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-white/45">
                  Surface area
                </dt>
                <dd className="display-type mt-2 text-4xl">
                  {calculationResult.areaSquareMetres.toLocaleString('en-NG', {
                    maximumFractionDigits: 2,
                  })}{' '}
                  m²
                </dd>
              </div>
              <div className="bg-ink/80 p-5">
                <dt className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-white/45">
                  Whole units required
                </dt>
                <dd className="display-type mt-2 text-5xl text-amber">
                  {calculationResult.purchasableUnits}
                </dd>
              </div>
              <div className="bg-ink/80 p-5">
                <dt className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-white/45">
                  Estimated product cost
                </dt>
                <dd className="mt-2 text-xl font-black">
                  {formatMoney(calculationResult.estimatedCostKobo)}
                </dd>
              </div>
            </dl>
            <form action={addCartItemAction} className="mt-5">
              <input
                name="variantId"
                type="hidden"
                value={selectedEntry.variant.id}
              />
              <input
                name="quantity"
                type="hidden"
                value={calculationResult.purchasableUnits}
              />
              <button className="button-primary w-full" type="submit">
                Add estimate to cart
                <Plus aria-hidden="true" size={17} />
              </button>
            </form>
            <p className="mt-5 text-[0.7rem] leading-5 text-white/45">
              Estimate only. It excludes delivery, labour, accessories, and
              site-specific conditions. Coverage and prices are placeholders.
            </p>
          </>
        ) : (
          <div className="mt-8 rounded-2xl border border-white/15 p-6 text-sm leading-6 text-white/55">
            Enter positive dimensions to see an estimate.
          </div>
        )}
      </div>
    </div>
  );
}
