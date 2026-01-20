import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig'; 
import type { Locker } from './types';

// Centralized Configuration
export const INITIAL_LOCKERS: Locker[] = [
  { id: 1, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED' },
  { id: 2, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED' },
];

// Custom Hook to manage Locker State
export function useLockerSystem() {
  const [lockers, setLockers] = useState<Locker[]>(INITIAL_LOCKERS);

  // --- 1. FIREBASE SYNC ---
  useEffect(() => {
    const q = query(
      collection(db, "transactions"), 
      where("status", "==", "paid_pending") 
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activeTransactions: Record<number, any> = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.lockerId) {
          activeTransactions[data.lockerId] = data;
        }
      });

      setLockers(prevLockers => prevLockers.map(locker => {
        const trx = activeTransactions[locker.id];
        if (trx) {
          return {
            ...locker,
            status: 'occupied',
            price: trx.price,
            pin: trx.pin,
            laundryStatus: trx.laundryStatus 
          };
        } else {
          // Reset if previously occupied
          if (locker.status === 'occupied') {
             return { ...locker, status: 'available', price: undefined, pin: undefined, laundryStatus: undefined };
          }
          return locker;
        }
      }));
    });

    return () => unsubscribe();
  }, []);

  // --- 2. HARDWARE POLLING ---
  useEffect(() => {
    const fetchHardwareStatus = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/status');
        const data = await response.json();

        setLockers(prevLockers => prevLockers.map(locker => {
          let hardwareData = null;
          if (locker.id === 1) hardwareData = data.l1;
          if (locker.id === 2) hardwareData = data.l2;

          if (hardwareData) {
            return {
              ...locker,
              weight: hardwareData.weight, 
              doorStatus: hardwareData.door 
            };
          }
          return locker;
        }));
      } catch (error) {
        // Silently fail or log sparingly to avoid console spam
      }
    };

    // Initial fetch
    fetchHardwareStatus();
    // Poll every 1s
    const intervalId = setInterval(fetchHardwareStatus, 1000);
    return () => clearInterval(intervalId);
  }, []);

  return { lockers, setLockers };
}