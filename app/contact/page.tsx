import type { Metadata } from 'next';
import { Clock3, Mail, MapPin, Phone } from 'lucide-react';

import { siteConfig } from '@/lib/config/site';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contact BridgegateShop and Specta.',
};

export default function ContactPage() {
  const contactDetails = [
    {
      icon: Phone,
      label: 'Telephone',
      value: siteConfig.contact.phoneDisplay,
    },
    {
      icon: Mail,
      label: 'Email',
      value: siteConfig.contact.email,
    },
    {
      icon: MapPin,
      label: 'Store',
      value: siteConfig.contact.address,
    },
    {
      icon: Clock3,
      label: 'Opening hours',
      value: siteConfig.contact.openingHours,
    },
  ];

  return (
    <div className="shell py-12 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[0.78fr_1fr] lg:gap-16">
        <div>
          <p className="eyebrow text-clay">Contact</p>
          <h1 className="display-type mt-5 text-balance text-5xl leading-[0.98] sm:text-6xl">
            Tell us what the project needs.
          </h1>
          <p className="mt-5 text-base leading-7 text-muted">
            Contact values are placeholders until Specta supplies the approved
            public details.
          </p>
          <div className="mt-8 grid gap-3">
            {contactDetails.map((contactDetail) => {
              const ContactIcon = contactDetail.icon;

              return (
                <div
                  className="flex items-start gap-4 rounded-2xl bg-paper p-5"
                  key={contactDetail.label}
                >
                  <ContactIcon
                    aria-hidden="true"
                    className="mt-0.5 text-clay"
                    size={19}
                  />
                  <div>
                    <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-muted">
                      {contactDetail.label}
                    </p>
                    <p className="mt-1 text-sm font-bold">
                      {contactDetail.value}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <form className="rounded-[2rem] border border-ink/10 bg-paper p-6 shadow-card sm:p-9">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-black">
              Full name
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="Your full name"
                type="text"
              />
            </label>
            <label className="grid gap-2 text-sm font-black">
              Phone number
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="+234..."
                type="tel"
              />
            </label>
            <label className="grid gap-2 text-sm font-black sm:col-span-2">
              Email address
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="you@example.com"
                type="email"
              />
            </label>
            <label className="grid gap-2 text-sm font-black sm:col-span-2">
              How can we help?
              <textarea
                className="min-h-36 rounded-xl border border-ink/15 bg-canvas p-4 font-normal"
                placeholder="Share the product, order, or project question."
              />
            </label>
          </div>
          <button
            className="mt-6 min-h-14 w-full cursor-not-allowed rounded-full bg-ink/15 px-5 text-sm font-black text-ink/45"
            disabled
            type="button"
          >
            Contact connection pending
          </button>
          <p className="mt-4 text-xs leading-5 text-muted">
            The durable enquiry service and approved privacy notice must be
            connected before this form can accept personal data.
          </p>
        </form>
      </div>
    </div>
  );
}
