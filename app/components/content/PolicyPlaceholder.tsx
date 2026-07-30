import { FileCheck2 } from 'lucide-react';

type PolicyPlaceholderProps = {
  eyebrow: string;
  title: string;
  summary: string;
  sections: Array<{
    title: string;
    description: string;
  }>;
};

export function PolicyPlaceholder({
  eyebrow,
  title,
  summary,
  sections,
}: PolicyPlaceholderProps) {
  return (
    <div className="shell py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow text-clay">{eyebrow}</p>
        <h1 className="display-type mt-5 text-balance text-5xl leading-[0.98] sm:text-6xl">
          {title}
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">{summary}</p>
      </div>

      <div className="mt-10 rounded-2xl border border-amber/50 bg-amber/15 p-5">
        <p className="flex items-start gap-3 text-sm leading-6">
          <FileCheck2
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-clay"
            size={19}
          />
          <span>
            <strong>Draft structure only.</strong> Specta and its qualified
            adviser must approve the binding policy text and version before
            this page can be published.
          </span>
        </p>
      </div>

      <div className="mt-8 grid gap-4">
        {sections.map((section, sectionIndex) => (
          <section
            className="rounded-[1.75rem] border border-ink/10 bg-paper p-7 sm:p-9"
            key={section.title}
          >
            <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-clay">
              Section {String(sectionIndex + 1).padStart(2, '0')}
            </p>
            <h2 className="mt-4 text-xl font-black">{section.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
              {section.description}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
