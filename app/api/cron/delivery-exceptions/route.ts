import { isCronRequestAuthorized } from '@/lib/security/cronAuthorization';
import { createDeliveryOverdueService } from '@/lib/services/fulfilment/DeliveryOverdueService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function detectDeliveryExceptions(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json(
      { success: false, error: 'Unauthorized.' },
      { status: 401 },
    );
  }

  try {
    const result = await createDeliveryOverdueService().flagOverdueDeliveries();
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('Delivery exception detection failed:', error);
    return Response.json(
      { success: false, error: 'Delivery exception detection failed.' },
      { status: 500 },
    );
  }
}

export const GET = detectDeliveryExceptions;
export const POST = detectDeliveryExceptions;
