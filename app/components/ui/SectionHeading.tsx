import { cn } from '@/lib/utils/cn';

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  inverse?: boolean;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  inverse = false,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'max-w-2xl',
        align === 'center' && 'mx-auto text-center',
        inverse && 'text-white',
      )}
    >
      <p
        className={cn(
          'eyebrow',
          inverse ? 'text-white/60' : 'text-clay',
          align === 'center' &&
            'justify-center before:content-[normal]',
        )}
      >
        {eyebrow}
      </p>
      <h2 className="display-type mt-5 text-balance text-4xl leading-[1.02] sm:text-5xl">
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            'mt-5 text-base leading-7 sm:text-lg',
            inverse ? 'text-white/65' : 'text-muted',
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
