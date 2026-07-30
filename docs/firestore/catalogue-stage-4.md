# Stage 4 Catalogue Application Slice

Stage 4 turns the Stage 3 Firestore contract into an end-to-end catalogue
application. Staff mutations, public reads, search projections, and media
processing all execute in server-only modules. Browser Firebase remains
authentication-only, which preserves the Vercel and default-deny architecture.

## Runtime boundaries

| Surface | Runtime | Firebase access |
|---|---|---|
| Public catalogue pages | Next.js server | Firebase Admin through repositories |
| Admin catalogue forms | Next.js Server Actions | Firebase Admin through services |
| Upload intent/finalise APIs | Next.js Node route handlers | Firebase Admin and media adapter |
| Product image delivery | Next.js Node route handler | Ready-media lookup and signed read |
| Browser components | Browser | Authentication only; no catalogue SDK |

`CATALOGUE_DATA_SOURCE=auto` selects Firestore when Admin credentials are
configured and otherwise renders the deterministic preview catalogue.
Production must set `CATALOGUE_DATA_SOURCE=firestore` so a credential mistake
fails visibly instead of publishing preview content.

## Mutation and access model

The catalogue service owns category, product, variant, slug, SKU, search, and
audit writes. Server Actions verify the signed-in staff actor and granular
permission before passing validated input to that service:

- `catalogue.category.manage`
- `catalogue.product.manage`
- `catalogue.product.publish`
- `catalogue.product.archive`
- `catalogue.variant.manage`
- `catalogue.media.manage`
- `catalogue.publish.override` for an owner-approved image-count override

Every mutable entity uses an expected version. Stale forms fail with a
conflict instead of overwriting a newer edit. Slug and SKU claims are reserved
inside the same Firestore transaction as their owner. Previous slug claims
remain reserved and produce permanent public redirects; SKU claims remain
reserved after archive.

All catalogue changes write immutable audit events with actor, request ID,
action, entity, changed fields, and an optional reason. Browser Firestore and
Storage access remains default-deny.

## Publication rules

A product can be published only when:

1. its category is active;
2. at least one variant is active;
3. its selected primary media record is ready and belongs to the product; and
4. at least three ready images exist, unless an owner with
   `catalogue.publish.override` supplies a reason.

Publishing and later edits refresh the server-owned search projection. Product
archive removes that projection. A category cannot be archived while any
draft, active, or out-of-stock product still belongs to it.

## Search projection

`catalogueSearch` is a server-owned, bounded projection. It contains product
identity, category identity, status, rank, and normalised prefix tokens derived
from approved product/category text. Public search uses `array-contains`, then
reloads authoritative active products before rendering. One-character queries
fail closed with no Firestore scan.

This is intentionally a first-party Firestore search adapter. A later external
search provider can replace the repository without changing page contracts.

## Media pipeline

The media service uses a provider-neutral storage interface with a Firebase
Storage adapter:

1. staff requests a bounded upload intent;
2. the server creates a quarantined object path and short-lived signed write
   URL;
3. finalisation verifies the object size, declared content type, decoded image
   signature, and pixel dimensions;
4. Sharp produces WebP thumbnail, card, detail, and social derivatives;
5. an immutable ready media record stores derivative metadata;
6. public delivery accepts only ready media attached to an active product.

Current limits are 8 MB and 40 megapixels. SVG is not accepted. Quarantine and
approved objects are not browser-readable through Firebase rules.

## Vercel configuration

Configure the existing Firebase Admin variables documented in `.env.example`,
plus:

```text
CATALOGUE_DATA_SOURCE=firestore
APP_BASE_URL=https://your-production-domain.example
```

Use a least-privilege production service account and preserve private-key
newlines exactly. The upload finalisation and media delivery routes require the
Node runtime; do not convert them to Edge runtime. Revalidate catalogue routes
after every successful admin mutation, as the supplied Server Actions do.

## Local verification

Firebase CLI 15 requires Java 21. On this workstation Java 21 is installed at:

```powershell
$taskJavaHome = 'C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot'
$env:JAVA_HOME = $taskJavaHome
$env:Path = (Join-Path $taskJavaHome 'bin') +
  [IO.Path]::PathSeparator + $env:Path
npm run test:rules
```

The Stage 4 acceptance pass is:

```powershell
npm run typecheck
npm test
npm run lint
npm run build
```

The emulator suite covers claim races, optimistic concurrency, publication
validation, default-deny rules, search projection visibility, and media
validation/derivative creation.

## Next domain boundary

The next stage is inventory and cart authority. It should consume active
catalogue variants but must own stock reservations, availability transitions,
server-priced cart lines, and checkout revalidation. Catalogue records must not
become mutable inventory counters.
