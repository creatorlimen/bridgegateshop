import { cn } from '@/lib/utils/cn';
import type { StockState } from '@/lib/types/catalogue';

const stockStateContent: Record<
  StockState,
  { label: string; className: string }
> = {
  inStock: {
    label: 'In stock',
    className: 'bg-moss/10 text-moss',
  },
  lowStock: {
    label: 'Low stock',
    className: 'bg-amber/20 text-ink',
  },
  outOfStock: {
    label: 'Out of stock',
    className: 'bg-clay/10 text-clay',
  },
};

export function StockPill({ stockState }: { stockState: StockState }) {
  const content = stockStateContent[stockState];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.09em]',
        content.className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {content.label}
    </span>
  );
}
