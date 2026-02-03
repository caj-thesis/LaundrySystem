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

  // --- 1. FIREBASE SYNC (Transactions) ---
  useEffect(() => {
    // Listen for active transactions (occupied lockers)
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
          // If there is an active transaction, use its stored values
          return { 
            ...locker, 
            status: 'occupied', 
            price: trx.price, 
            pin: trx.pin, 
            laundryStatus: trx.laundryStatus,
            weight: trx.weight // Ensure stored weight is loaded
          };
        } else {
          // If no active transaction, ensure it is available
          if (locker.status === 'occupied') {
            return { 
              ...locker, 
              status: 'available', 
              price: undefined, 
              pin: undefined, 
              laundryStatus: undefined,
              weight: 0 
            };
          }
          return locker;
        }
      }));
    });

    return () => unsubscribe();
  }, []);

  // --- 2. HARDWARE POLLING (Local Bridge) ---
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
            // LOGIC FIX:
            // 1. Always update door status.
            // 2. ONLY update weight from hardware if the locker is 'available'.
            //    If it is 'occupied', we must trust the stored Transaction weight 
            //    so the price doesn't fluctuate or drop to 0 during pickup.
            
            const isOccupied = locker.status === 'occupied';

            return {
              ...locker,
              doorStatus: hardwareData.door ? 'OPEN' : 'CLOSED',
              weight: isOccupied ? locker.weight : hardwareData.weight 
            };
          }
          return locker;
        }));
      } catch (e) {
        // console.error("Hardware poll error", e);
      }
    };

    // Poll every 200ms for smooth scale updates
    const interval = setInterval(fetchHardwareStatus, 200);
    return () => clearInterval(interval);
  }, []);

  return { lockers };
}