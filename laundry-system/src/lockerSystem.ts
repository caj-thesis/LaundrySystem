import { useState, useEffect } from 'react';
import type { Locker } from './types';

export const INITIAL_LOCKERS: Locker[] = [
  { id: 1, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED', isConnected: true },
  { id: 2, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED', isConnected: true },
  { id: 3, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED', isConnected: true },
];

function normalizeWeight(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((Math.max(0, parsed) + Number.EPSILON) * 100) / 100;
}

function normalizeLocker(locker: Locker): Locker {
  return {
    ...locker,
    weight: normalizeWeight(locker.weight),
  };
}

export function useLockerSystem() {
  const [lockers, setLockers] = useState<Locker[]>(INITIAL_LOCKERS);

  useEffect(() => {
    const fetchLockers = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/lockers');
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data)) {
          setLockers(data.map((locker) => normalizeLocker(locker as Locker)));
        }
      } catch (error) {
        // Offline-first local polling fallback
      }
    };

    fetchLockers();
    const interval = setInterval(fetchLockers, 250);
    return () => clearInterval(interval);
  }, []);

  return { lockers };
}
