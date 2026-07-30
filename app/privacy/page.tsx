import type { Metadata } from 'next';

import { PolicyPlaceholder } from '@/app/components/content/PolicyPlaceholder';

export const metadata: Metadata = {
  title: 'Privacy',
};

export default function PrivacyPage() {
  return (
    <PolicyPlaceholder
      eyebrow="Privacy"
      title="Clear data use, consent, retention, and customer rights."
      summary="The final policy must be versioned and approved for the Nigerian operating context before any public form collects personal data."
      sections={[
        {
          title: 'Information and purpose',
          description:
            'Define each data category, collection point, business purpose, legal basis, processor, and whether the field is required.',
        },
        {
          title: 'Retention and security',
          description:
            'Define approved retention periods, protected records, access controls, disposal method, backup treatment, and incident ownership.',
        },
        {
          title: 'Choices and rights',
          description:
            'Define correction, access, export, restriction, deletion or anonymisation, marketing withdrawal, and verified request handling.',
        },
      ]}
    />
  );
}
