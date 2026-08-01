import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const serverOnlyModules = [
  'lib/config/checkoutSettings.ts',
  'lib/config/commerceDataSource.ts',
  'lib/repositories/orders/OrderRepository.ts',
  'lib/repositories/payments/PaymentAdminRepository.ts',
  'lib/repositories/inventory/InventoryAdminRepository.ts',
  'lib/security/cronAuthorization.ts',
  'lib/services/carts/CartService.ts',
  'lib/services/carts/authoritativeCart.ts',
  'lib/services/carts/cartSession.ts',
  'lib/services/inventory/InventoryService.ts',
  'lib/services/inventory/inventoryTransactionOperations.ts',
  'lib/services/orders/CheckoutService.ts',
  'lib/services/orders/OrderReservationExpiryService.ts',
  'lib/services/orders/resolvePaymentReturn.ts',
  'lib/services/payments/PaymentAttemptService.ts',
  'lib/services/payments/PaystackClient.ts',
  'lib/services/payments/PaystackWebhookService.ts',
] as const;

describe('inventory and cart runtime boundaries', () => {
  it('keeps every authoritative commerce module server-only', async () => {
    const moduleSources = await Promise.all(
      serverOnlyModules.map((modulePath) =>
        readFile(path.join(projectRoot, modulePath), 'utf8'),
      ),
    );

    for (const moduleSource of moduleSources) {
      expect(moduleSource.trimStart()).toMatch(
        /^import 'server-only';/,
      );
      expect(moduleSource).not.toContain("from 'firebase/firestore'");
    }
  });

  it('keeps the reservation job on the Node runtime', async () => {
    const routeSource = await readFile(
      path.join(
        projectRoot,
        'app/api/cron/reservations/route.ts',
      ),
      'utf8',
    );

    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource).toContain('isCronRequestAuthorized');
    expect(routeSource).toContain('expireDueReservations');
  });
});
