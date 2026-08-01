# Stage 5 Inventory and Authoritative Cart Slice

Stage 5 makes Firestore the authority for stock, reservations, and cart
pricing. All commerce reads and mutations run through server-only repositories
and services using Firebase Admin. Browser Firebase remains authentication-only,
which keeps secrets and authoritative rules inside the Vercel runtime.

## Runtime and ownership boundaries

| Surface | Domain owner | Browser access |
|---|---|---|
| `inventoryBalances/{variantId}` | Inventory service | Denied |
| `inventoryReservations/{reservationId}` | Inventory service | Denied |
| `inventoryMovements/{movementId}` | Inventory service | Denied |
| `carts/{cartId}` and item subcollection | Cart service | Denied |
| Product/search stock summaries | Inventory projection | Denied |
| Cart cookie | Server cart-session module | HTTP-only proof only |

Catalogue owns product and variant identity, publication, SKU, and price.
Inventory owns quantities and availability state. Cart owns requested
quantities and the last price shown to the customer, but always reloads current
catalogue price and stock before returning a cart or allowing checkout.

Every newly created variant receives an inventory balance in the same
transaction. Variant stock-management and low-stock-threshold changes update
that balance while preserving on-hand and reserved quantities. Stock management
cannot be disabled while a reservation is active.

## Inventory invariants

Each balance enforces:

```text
available = onHand - reserved
0 <= reserved <= onHand
```

`stockState` is derived from the balance and threshold. It is never accepted
from an editor or browser. Product and search availability summaries are
updated as projections after inventory transitions. Public catalogue queries
continue to expose published `outOfStock` products so customers receive an
explicit unavailable state rather than a false 404.

Manual adjustments:

1. validate movement direction and optimistic version;
2. read the variant, balance, and deterministic movement record;
3. apply the balance once;
4. append an immutable movement;
5. write the audit event and any low-stock outbox event; and
6. refresh product/search availability in the transaction.

The idempotency key identifies the movement. A replay with the same input
returns the existing result; reuse for a different effect fails with a
conflict.

## Reservation lifecycle

Reservation creation sorts all variant IDs before reading them, validates every
line, and writes no line when any line is unavailable. Managed stock moves from
`available` to `reserved`; `onHand` is unchanged.

The one-way terminal transitions are:

- `active -> committed`: reduce both `onHand` and `reserved`, then append a
  `reservationCommit` movement;
- `active -> released`: reduce `reserved` and return availability; or
- `active -> expired`: perform the same stock release with expiry metadata.

Terminal replays are safe and do not apply stock twice. Reservation-creation
replays must match cart, owner proof, lines, payment method, and expiry exactly.

The protected `/api/cron/reservations` route accepts the PRD `POST` contract and
`GET` for Vercel Cron. It expires at most 100 due reservations per invocation.
Set `CRON_SECRET` in Vercel; Vercel sends it as a Bearer token. A non-Vercel
scheduler may use the documented `CRON_AUTH_SECRET` alias.

Production must invoke cleanup every five minutes. Vercel Hobby currently
permits only daily cron schedules, which is too slow for checkout holds; use a
plan/scheduler that supports the required interval. The route is idempotent,
but Vercel does not retry failed cron invocations, so alerting is required.

## Authoritative cart

Guest carts use an opaque random cookie token. Only its SHA-256 hash is stored
in Firestore. Cart ownership checks use timing-safe hash comparison, and the
cookie is HTTP-only, secure in production, same-site `lax`, and scoped to the
application.

Cart operations:

- validate active product/variant status and quantity bounds;
- price from the current variant record;
- enforce the current inventory balance;
- persist only requested quantity and last displayed server price;
- return explicit `PRICE_CHANGED`, `OUT_OF_STOCK`, or `UNAVAILABLE` issues;
- require price acknowledgement before checkout validation; and
- reject empty or unresolved carts at checkout.

After sign-in, the guest and customer carts merge in one transaction.
Quantities combine once, clamp only when stock or the explicit line limit
requires it, and create durable disclosure notices for adjusted or unavailable
lines. The guest cart is marked `merged` with a target pointer. Replays verify
the original guest proof before returning the existing target.

The authentication session route performs the merge before creating the
application session, then clears the guest cookie only after a successful
merge.

## Query and index plan

Stage 5 adds indexes for:

- due active reservations ordered by expiry;
- active customer-cart lookup;
- inventory balance stock-state/threshold administration; and
- low-stock outbox processing.

Exact balance, movement, cart, and item lookups use deterministic document
paths. New filters require an explicit access pattern and index review.

## Vercel environment

Production requires the existing Firebase Admin variables plus:

```text
CATALOGUE_DATA_SOURCE=firestore
CRON_SECRET=<random value of at least 16 characters>
```

Do not set emulator hosts on Vercel. The current 30-day cart lifetime and
reservation minimum/maximum bounds are safe placeholder policy values. The
future protected commerce-settings domain must make them configurable without
retroactively shortening an existing snapshotted expiry.

## Verification

Firebase CLI 15 uses Java 21:

```powershell
$taskJavaHome = 'C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot'
$env:JAVA_HOME = $taskJavaHome
$env:Path = (Join-Path $taskJavaHome 'bin') +
  [IO.Path]::PathSeparator + $env:Path
npm run test:rules
```

The Stage 5 emulator suite covers adjustment replay, movement/audit writes,
final-unit concurrency, reservation create/release/commit/expiry, replay-owner
validation, variant balance initialization, active-reservation guards,
server pricing, stock limits, price acknowledgement, deleted variants, cart
merge replay, unavailable-line disclosure, and forged guest proofs.

The complete gate is:

```powershell
npm run typecheck
npm test
npm run test:rules
npm run lint
npm run build
```

## Next domain boundary

The next stage should create checkout orders from a validated cart and an
atomic inventory reservation. Order/payment webhooks must reuse the reservation
commit/release operations and must never implement a second stock counter.
Delivery, discount, payment, customer restriction, and settings validation
remain authoritative checkout responsibilities.
