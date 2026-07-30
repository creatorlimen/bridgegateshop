import Link from 'next/link';

import { cn } from '@/lib/utils/cn';

type BrandMarkProps = {
  className?: string;
  inverse?: boolean;
};

export function BrandMark({ className, inverse = false }: BrandMarkProps) {
  return (
    <Link
      className={cn(
        'inline-flex items-center gap-3 rounded-sm',
        inverse ? 'text-white' : 'text-ink',
        className,
      )}
      href="/"
      aria-label="BridgegateShop home"
    >
      <svg
        aria-hidden="true"
        className="h-10 w-10 shrink-0"
        viewBox="0 0 48 48"
        fill="none"
      >
        <rect
          width="48"
          height="48"
          rx="14"
          fill={inverse ? '#E7A933' : '#211F1B'}
        />
        <path
          d="M10 30.5h28M14 30.5V24a10 10 0 0 1 20 0v6.5M19 30.5V25a5 5 0 0 1 10 0v5.5"
          stroke={inverse ? '#211F1B' : '#FFFDF8'}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      <span className="leading-none">
        <span className="block text-[1.05rem] font-black tracking-[-0.035em]">
          Bridgegate
          <span className={inverse ? 'text-amber' : 'text-clay'}>Shop</span>
        </span>
        <span
          className={cn(
            'mt-1 block text-[0.58rem] font-bold uppercase tracking-[0.22em]',
            inverse ? 'text-white/55' : 'text-muted',
          )}
        >
          Powered by Specta
        </span>
      </span>
    </Link>
  );
}
