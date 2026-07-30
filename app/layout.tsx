import type { Metadata } from 'next';

import { SiteFooter } from '@/app/components/layout/SiteFooter';
import { SiteHeader } from '@/app/components/layout/SiteHeader';
import { WhatsAppButton } from '@/app/components/layout/WhatsAppButton';
import { siteConfig } from '@/lib/config/site';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://bridgegateshop.com.ng'),
  title: {
    default: 'BridgegateShop — Building finishes for Lagos projects',
    template: '%s | BridgegateShop',
  },
  description: siteConfig.description,
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
        <WhatsAppButton />
      </body>
    </html>
  );
}
