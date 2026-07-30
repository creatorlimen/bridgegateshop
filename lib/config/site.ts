export const siteConfig = {
  name: 'BridgegateShop',
  legalName: 'Specta',
  domain: 'bridgegateshop.com.ng',
  description:
    'Building finishing materials, practical guidance, and dependable fulfilment for projects across Lagos.',
  placeholderNotice:
    'Preview content — final business details, prices, and policies are pending approval.',
  contact: {
    phoneDisplay: '+234 800 000 0000',
    phoneHref: 'tel:+2348000000000',
    email: 'hello@bridgegateshop.com.ng',
    whatsappHref:
      'https://wa.me/2348000000000?text=Hi%2C%20I%20want%20to%20place%20an%20order%20on%20BridgegateShop.',
    address: 'Lagos, Nigeria — final store address pending',
    openingHours: 'Mon–Sat, 8:00am–6:00pm — placeholder hours',
  },
  navigation: [
    { href: '/shop', label: 'Shop' },
    { href: '/calculator', label: 'Calculator' },
    { href: '/bulk-quote', label: 'Bulk quote' },
    { href: '/delivery', label: 'Delivery' },
    { href: '/about', label: 'About' },
  ],
} as const;
