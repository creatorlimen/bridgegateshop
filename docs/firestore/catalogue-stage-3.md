# Stage 3 Catalogue Data Contract

This document records the implemented Firestore catalogue slice. It is
deliberately narrower than the final commerce model: inventory, cart, order,
payment, fulfilment, content, and credit indexes are added with their owning
repositories so unused composite indexes do not create write amplification.

## Ownership and access

| Collection | Domain owner | Browser access | Lifecycle |
|---|---|---|---|
| `categories` | Catalogue | Denied | `draft -> active -> archived` |
| `products` | Catalogue | Denied | `draft -> active/outOfStock -> archived` |
| `productVariants` | Catalogue/pricing | Denied | `active/inactive -> archived` |
| `productMedia` | Catalogue/media | Denied | `pending -> processing -> ready/failed` |
| `slugClaims` | Catalogue transaction | Denied | Created or moved with its owner |
| `skuClaims` | Catalogue transaction | Denied | Retained after SKU archive by default |

Next.js server modules use Firebase Admin. No catalogue Firestore client is
exported, and the browser Firebase module remains authentication-only.
Firestore and Storage rules therefore remain default-deny for customer and
staff SDKs.

## Validation and invariants

- Stored records are parsed as untrusted data by the Zod schemas in
  `lib/schemas`.
- Mutable records require schema version, actor references, timestamps, and an
  optimistic-concurrency version.
- Published products require primary media and a publication timestamp.
- Price summaries cannot contain an inverted minimum/maximum range.
- Compare-at prices must exceed the current price.
- Slugs, document IDs, SKUs, arrays, text, media metadata, and page sizes are
  bounded before repository use.
- Invalid stored documents fail closed with a typed data error.
- Public product pagination uses a bounded opaque cursor over publication
  order, name, and document ID.

Slug and SKU uniqueness is never implemented as query-then-write. Claim
helpers read and create deterministic claim documents inside the same
Firestore transaction used to create or rename the owning entity. Concurrent
claim tests require one winner and one explicit conflict.

## Implemented query/index plan

| Repository query | Composite index |
|---|---|
| Active categories | `status`, `displayOrder`, `name` ascending |
| Active products | `status`, `publicationOrder`, `name` ascending |
| Active products in category | `categoryId`, `status`, `publicationOrder`, `name` ascending |
| Active product variants | `productId`, `status`, `publicationOrder`, `name` ascending |

Exact document-ID lookups and equality-only slug lookups use Firestore's
single-field indexes. New admin filter combinations require an explicit access
pattern and index review rather than unbounded in-memory filtering.

## Transaction boundaries

A future catalogue create/publish service must:

1. Parse authoritative server input.
2. Verify the active category and approved ready media.
3. Begin a Firestore transaction.
4. Reserve product/category slug and every new SKU claim.
5. Write the entity and variants with the same transaction.
6. Write audit/outbox effects required by the action.
7. Commit, then trigger cache revalidation.

Firestore transactions must read all claim and dependency documents before
writes. SKU claims remain reserved on archive unless an owner-approved
migration explicitly authorises reuse.

## Fixtures, retention, and export

The deterministic emulator fixture contains POP Paint and White Bond plus ten
placeholder products, variants with exact and fractional coverage, ready media,
slug claims, and SKU claims. It contains no real customer data and is never a
production content source.

Archived catalogue records are retained for order and audit traceability.
Product media is deleted only through a reviewed lifecycle that proves no
published product, immutable order snapshot, document, or content record still
references it. Catalogue collections and approved media are covered by the
platform Firestore/Storage export and restore policy.

Schema changes increment `schemaVersion`, ship with a tested migration, and
remain backward-readable during rolling deployment.
