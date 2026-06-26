'use client';

/**
 * useShipmentPositions — polls the tracking feed so Atlas can animate moving
 * vessel dots along their sea-routes.
 *
 * Feed-agnostic: it calls /api/shipments/positions, which returns mock-simulated
 * motion today and real Terminal49 + AISstream positions once TRACKING_MODE=live.
 * The hook doesn't know or care which — swapping the backend feed changes nothing
 * here. See backend/src/integrations/tracking + build skill pericles-atlas-mocker.
 */

import { useEffect, useRef, useState } from 'react';
import { getShipmentPositions, type ShipmentPosition } from '@/lib/api-client';

export interface UseShipmentPositionsResult {
  positions: ShipmentPosition[];
  /** 'mock' until the live feed is wired; surface it in diligence/demo copy. */
  source: 'mock' | 'live' | null;
  isLoading: boolean;
}

/**
 * @param organizationId tenant whose shipments to track (null = idle)
 * @param intervalMs poll cadence; 4s gives smooth motion without hammering the API
 */
export function useShipmentPositions(
  organizationId: string | null | undefined,
  intervalMs = 4000,
): UseShipmentPositionsResult {
  const [positions, setPositions] = useState<ShipmentPosition[]>([]);
  const [source, setSource] = useState<'mock' | 'live' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!organizationId) {
      setPositions([]);
      setSource(null);
      return;
    }

    let active = true;
    setIsLoading(true);

    const poll = async () => {
      const res = await getShipmentPositions(organizationId);
      if (!active) return;
      if (res.success && res.data) {
        setPositions(res.data);
        setSource(res.data[0]?.source ?? 'mock');
      }
      setIsLoading(false);
    };

    poll();
    timer.current = setInterval(poll, intervalMs);

    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [organizationId, intervalMs]);

  return { positions, source, isLoading };
}
