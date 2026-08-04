import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const serverOnlyModules = [
  'lib/config/checkoutSettings.ts',
  'lib/config/commerceDataSource.ts',
  'lib/config/fulfilmentSettings.ts',
  'lib/config/notificationSettings.ts',
  'lib/repositories/fulfilment/DeliveryRepository.ts',
  'lib/repositories/orders/OrderFinancialRepository.ts',
  'lib/repositories/orders/OrderRepository.ts',
  'lib/repositories/payments/FinancialDocumentRepository.ts',
  'lib/repositories/payments/PaymentAdminRepository.ts',
  'lib/repositories/payments/TransferEvidenceRepository.ts',
  'lib/repositories/inventory/InventoryAdminRepository.ts',
  'lib/security/cronAuthorization.ts',
  'lib/services/carts/CartService.ts',
  'lib/services/carts/authoritativeCart.ts',
  'lib/services/carts/cartSession.ts',
  'lib/services/fulfilment/createDeliveryRecord.ts',
  'lib/services/fulfilment/DeliveryOverdueService.ts',
  'lib/services/fulfilment/DeliveryExceptionService.ts',
  'lib/services/fulfilment/DeliveryTransitionService.ts',
  'lib/services/fulfilment/TrackingService.ts',
  'lib/services/notifications/createNotificationProviders.ts',
  'lib/services/notifications/NotificationProvider.ts',
  'lib/services/notifications/NotificationService.ts',
  'lib/services/inventory/InventoryService.ts',
  'lib/services/inventory/inventoryTransactionOperations.ts',
  'lib/services/inventory/releaseCheckoutInventoryInTransaction.ts',
  'lib/services/orders/CheckoutService.ts',
  'lib/services/orders/OrderCancellationService.ts',
  'lib/services/orders/OrderReservationExpiryService.ts',
  'lib/services/orders/resolvePaymentReturn.ts',
  'lib/services/outbox/FulfilmentOutboxWorker.ts',
  'lib/services/outbox/writeOutboxEvent.ts',
  'lib/services/payments/AlternativePaymentService.ts',
  'lib/services/payments/FinancialDocumentService.ts',
  'lib/services/payments/PaymentAttemptService.ts',
  'lib/services/payments/PaystackClient.ts',
  'lib/services/payments/PaystackWebhookService.ts',
  'lib/services/payments/RefundService.ts',
  'lib/services/payments/renderFinancialDocumentPdf.ts',
  'lib/services/payments/ReturnStockService.ts',
  'lib/services/payments/TransferEvidenceService.ts',
  'lib/services/settings/CommercePaymentSettingsService.ts',
  'lib/services/settings/FulfilmentSettingsService.ts',
  'lib/services/settings/NotificationSettingsService.ts',
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

  it('keeps fulfilment outbox processing on the authorised Node runtime', async () => {
    const routeSource = await readFile(
      path.join(
        projectRoot,
        'app/api/cron/outbox/route.ts',
      ),
      'utf8',
    );

    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource).toContain('isCronRequestAuthorized');
    expect(routeSource).toContain('processDueEvents');
  });

  it('keeps overdue-delivery detection on the authorised Node runtime', async () => {
    const routeSource = await readFile(
      path.join(
        projectRoot,
        'app/api/cron/delivery-exceptions/route.ts',
      ),
      'utf8',
    );

    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource).toContain('isCronRequestAuthorized');
    expect(routeSource).toContain('flagOverdueDeliveries');
  });
});
