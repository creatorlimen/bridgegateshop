'use server';

import { headers } from 'next/headers';

import {
  createTrackingService,
  TrackingLookupError,
  type TrackingLookupResult,
} from '@/lib/services/fulfilment/TrackingService';

export type TrackingActionState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  result: TrackingLookupResult | null;
};

export const initialTrackingActionState: TrackingActionState = {
  status: 'idle',
  message: null,
  result: null,
};

export async function lookupOrderTrackingAction(
  _previousState: TrackingActionState,
  formData: FormData,
): Promise<TrackingActionState> {
  const requestHeaders = await headers();
  const forwardedAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0];
  const ipAddress =
    forwardedAddress?.trim() || requestHeaders.get('x-real-ip')?.trim() || 'unknown';
  try {
    const result = await createTrackingService().lookupWithFactor({
      reference: String(formData.get('reference') ?? ''),
      factor: String(formData.get('factor') ?? ''),
      ipAddress,
    });
    return { status: 'success', message: null, result };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof TrackingLookupError
          ? error.message
          : 'Tracking is temporarily unavailable. Please try again later.',
      result: null,
    };
  }
}
