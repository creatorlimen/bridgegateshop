import { isCronRequestAuthorized } from '@/lib/security/cronAuthorization';
import { createInventoryService } from '@/lib/services/inventory/InventoryService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function expireReservations(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json(
      {
        success: false,
        error: 'Unauthorized.',
      },
      { status: 401 },
    );
  }

  try {
    const result = await createInventoryService().expireDueReservations();

    return Response.json({
      success: true,
      expiredReservations: result.expired,
    });
  } catch (error) {
    console.error('❌ Reservation expiry job failed:', error);

    return Response.json(
      {
        success: false,
        error: 'Reservation expiry failed.',
      },
      { status: 500 },
    );
  }
}

export const GET = expireReservations;
export const POST = expireReservations;
