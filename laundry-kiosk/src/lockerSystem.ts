import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig'; 
import type { Locker } from './types';

// Centralized Configuration (Added Locker 3)
export const INITIAL_LOCKERS: Locker[] = [
  { id: 1, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED', isConnected: true },
  { id: 2, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED', isConnected: true },
  { id: 3, capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED', isConnected: true },
];

// Custom Hook to manage Locker State
export function useLockerSystem() {
  const [lockers, setLockers] = useState<Locker[]>(INITIAL_LOCKERS);

  // --- 1. FIREBASE SYNC (Transactions / Business Logic) ---
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
        
        // Preserve existing hardware state (door/connection) while updating business logic
        if (trx) {
          // If there is an active transaction, use its stored values
          return { 
            ...locker, 
            status: 'occupied', 
            price: trx.price, 
            pin: trx.pin, 
            laundryStatus: trx.laundryStatus,
            weight: trx.weight, // Ensure stored weight is loaded
            currentTransactionId: trx.transactionId // <-- ADDED: Map transaction ID here
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
              weight: 0,
              currentTransactionId: undefined // <-- ADDED: Clear it out when available
            };
          }
          return locker;
        }
      }));
    });

    return () => unsubscribe();
  }, []);

  // --- 2. HARDWARE POLLING (Connection, Door, Live Weight) ---
  useEffect(() => {
    const fetchHardwareStatus = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/status');
        const data = await response.json();
        
        setLockers(prevLockers => prevLockers.map(locker => {
          let hardwareData = null;
          if (locker.id === 1) hardwareData = data.l1;
          if (locker.id === 2) hardwareData = data.l2;
          if (locker.id === 3) hardwareData = data.l3;
          
          if (hardwareData) {
            const isOccupied = locker.status === 'occupied';

            // Normalize Door Status (Arduino sends 'OPE'/'CLO' or 'OPEN'/'CLOSED')
            const rawDoor = hardwareData.door || 'CLOSED';
            const normalizedDoor = (rawDoor === 'OPE' || rawDoor === 'OPEN') ? 'OPEN' : 'CLOSED';

            return {
              ...locker,
              // [CRITICAL] Update Connection Status
              isConnected: hardwareData.isConnected !== undefined ? hardwareData.isConnected : true,
              
              // Update Door
              doorStatus: normalizedDoor,
              
              // Update Weight: If occupied, trust the transaction weight. If available, show live scale.
              weight: isOccupied ? locker.weight : (hardwareData.weight || 0)
            };
          }
          return locker;
        }));
      } catch (e) {
        // console.error("Hardware poll error", e);
      }
    };

    // Poll every 200ms for smooth scale updates & instant connection checks
    const interval = setInterval(fetchHardwareStatus, 200);
    return () => clearInterval(interval);
  }, []);

  return { lockers };
}