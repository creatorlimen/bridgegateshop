import { isCronRequestAuthorized } from '@/lib/security/cronAuthorization';
import { createFulfilmentOutboxWorker } from '@/lib/services/outbox/FulfilmentOutboxWorker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function processOutbox(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json(
      { success: false, error: 'Unauthorized.' },
      { status: 401 },
    );
  }
  try {
    const result = await createFulfilmentOutboxWorker().processDueEvents();
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('Fulfilment outbox job failed:', error);
    return Response.json(
      { success: false, error: 'Fulfilment outbox processing failed.' },
      { status: 500 },
    );
  }
}

export const GET = processOutbox;
export const POST = processOutbox;
