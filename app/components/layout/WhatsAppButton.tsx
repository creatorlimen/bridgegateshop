import { MessageCircle } from 'lucide-react';

import { siteConfig } from '@/lib/config/site';

export function WhatsAppButton() {
  return (
    <a
      className="fixed bottom-5 right-5 z-30 flex min-h-12 items-center gap-2 rounded-full bg-moss px-4 text-sm font-black text-white shadow-lift transition hover:-translate-y-1 hover:bg-moss/90"
      href={siteConfig.contact.whatsappHref}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with BridgegateShop on WhatsApp"
    >
      <MessageCircle aria-hidden="true" size={20} />
      <span className="hidden sm:inline">WhatsApp</span>
    </a>
  );
}
