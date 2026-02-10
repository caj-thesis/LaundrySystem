import { useState, useCallback } from 'react';
import { WelcomePage } from './components/WelcomePage';
import { ProcessSelectionPage } from './components/ProcessSelectionPage';
import { AvailableLockersPage } from './components/AvailableLockersPage';
import { LaundryTypeSelectionPage } from './components/LaundryTypeSelectionPage'; 
import { DropOffInstructionsPage } from './components/DropOffInstructionsPage';
import { WeighingPage } from './components/WeighingPage';
import { PickupLockersPage } from './components/PickupLockersPage';
import { PinCodePage } from './components/PinCodePage';
import { PaymentPage } from './components/PaymentPage';
import { ThankYouPage } from './components/ThankYouPage';
import './styles/app.css';

// --- FIREBASE IMPORTS ---
import { db } from '../firebaseConfig'; 
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  updateDoc, 
  doc 
} from 'firebase/firestore'; 

import { useLockerSystem } from './lockerSystem'; 

type Screen = 
  | 'welcome'
  | 'process-selection'
  | 'dropoff-instructions'
  | 'available-lockers'
  | 'laundry-type-selection'
  | 'weighing-process'
  | 'pickup-lockers'
  | 'pin-entry'
  | 'payment'
  | 'thank-you';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('welcome');
  const [selectedLockerId, setSelectedLockerId] = useState<number | null>(null);
  const [processType, setProcessType] = useState<'dropoff' | 'pickup' | null>(null);
  
  // State for pricing and laundry type
  const [selectedPricePerKg, setSelectedPricePerKg] = useState<number>(25);
  // NEW: State to store the selected laundry type name (e.g., 'Clothes' or 'Bed Sheets')
  const [selectedLaundryType, setSelectedLaundryType] = useState<string>('Clothes');

  // Use the centralized hook for locker state
  const { lockers } = useLockerSystem();

  const [lastGeneratedPin, setLastGeneratedPin] = useState<string | null>(null);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [lastWeight, setLastWeight] = useState<number>(0); 
  const [lastPrice, setLastPrice] = useState<number>(0);   

  const selectedLocker = lockers.find(l => l.id === selectedLockerId);

  // --- NAVIGATION HANDLERS ---
  const handleWelcomeNext = () => setCurrentScreen('process-selection');

  const handleProcessSelection = (process: 'dropoff' | 'pickup') => {
    setProcessType(process);
    if (process === 'dropoff') {
      setCurrentScreen('dropoff-instructions');
    } else {
      setCurrentScreen('pickup-lockers');
    }
  };

  const handleProcessBack = () => setCurrentScreen('welcome');

  const handleInstructionsNext = () => {
    setCurrentScreen('available-lockers');
  };

  const handleInstructionsBack = () => {
    setCurrentScreen('process-selection');
  };

  const handleLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    setCurrentScreen('laundry-type-selection');
  };

  // UPDATED: Handler for Laundry Type Selection captures both price and type name
  const handleLaundryTypeSelect = (price: number, type: string) => {
    setSelectedPricePerKg(price);
    setSelectedLaundryType(type); // Store the type name
    setCurrentScreen('weighing-process');
  };

  const handleLaundryTypeBack = () => {
    setCurrentScreen('available-lockers');
  };

  const handleAvailableLockersBack = () => setCurrentScreen('dropoff-instructions');

  // --- HANDLE DROP OFF (LOCKER BECOMES OCCUPIED) ---
  const handleDropOffComplete = async (finalPrice: number, finalWeight: number, phoneNumber?: string) => { 
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    const newTransactionId = `TRX-${Math.floor(Date.now() / 1000)}`;
    
    setLastGeneratedPin(newPin);
    setLastTransactionId(newTransactionId);
    setLastWeight(finalWeight);
    setLastPrice(finalPrice);

    setCurrentScreen('thank-you');

    if (selectedLockerId) {
      try {
        // 1. Hardware Call
        fetch('http://localhost:3000/api/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId }),
        }).catch(e => console.error("Hardware Error:", e));

        // 2. Create Transaction Record
        await addDoc(collection(db, "transactions"), {
          transactionId: newTransactionId,
          lockerId: selectedLockerId,
          pin: newPin,
          price: finalPrice,
          weight: finalWeight,
          pricePerKg: selectedPricePerKg,
          phoneNumber: phoneNumber || "N/A", 
          type: selectedLaundryType, 
          status: 'paid_pending',
          laundryStatus: 'Pending', 
          
          // --- NEW: Initialize Reminder Fields ---
          triggerReminder: false,
          reminderSent: false,
          // ---------------------------------------

          timestamp: new Date()
        });

        // 3. Update Locker Status in DB
        console.log(`Updating Locker ${selectedLockerId} to occupied...`);
        
        const lockerRef = doc(db, "lockers", String(selectedLockerId)); 
        
        await updateDoc(lockerRef, { 
          status: 'occupied',
          currentTransactionId: newTransactionId 
        });
        
        console.log("Locker DB update successful.");

      } catch (e) {
        console.error("CRITICAL ERROR SAVING DATA:", e);
      }
    }
  };

  const handleWeighingBack = () => {
    setCurrentScreen('laundry-type-selection');
  };

  const handlePickupLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    setCurrentScreen('pin-entry');
  };

  const handlePickupLockersBack = () => setCurrentScreen('process-selection');

  const handlePinVerified = () => setCurrentScreen('payment');

  const handlePinCancel = () => setCurrentScreen('pickup-lockers');

  const handlePaymentCancel = () => setCurrentScreen('pickup-lockers');

  // --- HANDLE PICKUP (LOCKER BECOMES AVAILABLE) ---
  const handlePaymentComplete = async () => {
    const paymentId = `PAY-${Math.floor(Date.now() / 1000)}`;
    setLastTransactionId(paymentId);

    if (selectedLocker) {
      setLastWeight(selectedLocker.weight || 0);
      setLastPrice(selectedLocker.price || 0);
    }

    if (selectedLockerId) {
      try {
        // 1. Hardware Call (Unlocks the door)
        fetch('http://localhost:3000/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId })
        }).catch(err => console.error("Unlock failed:", err));

        // 2. Update Transaction to Completed
        const q = query(
          collection(db, "transactions"),
          where("lockerId", "==", selectedLockerId),
          where("status", "==", "paid_pending")
        );

        const querySnapshot = await getDocs(q);
        const updates = querySnapshot.docs.map(d => 
          updateDoc(doc(db, "transactions", d.id), {
            status: 'completed',
            pickedUpAt: new Date(),
            paymentId: paymentId
          })
        );
        await Promise.all(updates);

        // 3. Update Locker Status in DB
        console.log(`Updating Locker ${selectedLockerId} to available...`);
        
        const lockerRef = doc(db, "lockers", String(selectedLockerId));
        
        await updateDoc(lockerRef, { 
          status: 'available',
          currentTransactionId: null 
        });

        console.log("Locker DB update successful.");

      } catch (e) {
        console.error("Error completing payment:", e);
      }
    }
    setCurrentScreen('thank-you');
  };

  const handleReset = useCallback(() => {
    if (processType === 'pickup' && selectedLockerId) {
      console.log(`[RESET] Auto-locking Locker ${selectedLockerId} after pickup`);
      fetch('http://localhost:3000/api/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId: selectedLockerId }),
      }).catch(e => console.error("Auto-lock failed:", e));
    }

    setCurrentScreen('welcome');
    setSelectedLockerId(null);
    setProcessType(null);
    setLastGeneratedPin(null);
    setLastTransactionId(null);
    // Reset price and type to defaults
    setSelectedPricePerKg(25);
    setSelectedLaundryType('Clothes');
  }, [processType, selectedLockerId]);

  return (
    <div className="app-container">
      <div className="kiosk-screen">
        {currentScreen === 'welcome' && <WelcomePage onNext={handleWelcomeNext} />}
        
        {currentScreen === 'process-selection' && (
          <ProcessSelectionPage onSelect={handleProcessSelection} onBack={handleProcessBack} />
        )}
        
        {currentScreen === 'dropoff-instructions' && (
           <DropOffInstructionsPage 
             onNext={handleInstructionsNext}
             onBack={handleInstructionsBack}
           />
        )}
        
        {currentScreen === 'available-lockers' && (
          <AvailableLockersPage 
            lockers={lockers.filter(l => l.status === 'available')} 
            onSelectLocker={handleLockerSelect} 
            onBack={handleAvailableLockersBack} 
          />
        )}

        {/* LAUNDRY TYPE SELECTION */}
        {currentScreen === 'laundry-type-selection' && (
          <LaundryTypeSelectionPage 
            onSelect={handleLaundryTypeSelect}
            onBack={handleLaundryTypeBack}
          />
        )}
        
        {/* WEIGHING PROCESS */}
        {currentScreen === 'weighing-process' && selectedLockerId && (
          <WeighingPage 
            lockerId={selectedLockerId} 
            currentWeight={lockers.find(l => l.id === selectedLockerId)?.weight || 0}
            // UPDATED: Pass the dynamic price
            pricePerKg={selectedPricePerKg}
            // @ts-ignore 
            onComplete={handleDropOffComplete} 
            onBack={handleWeighingBack}
          />
        )}
        
        {currentScreen === 'pickup-lockers' && (
          <PickupLockersPage 
            lockers={lockers.filter(l => l.status === 'occupied')} 
            onSelectLocker={handlePickupLockerSelect} 
            onBack={handlePickupLockersBack} 
          />
        )}
        
        {currentScreen === 'pin-entry' && selectedLocker && (
          <PinCodePage 
            lockerId={selectedLocker.id}
            correctPin={selectedLocker.pin || '0000'}
            onVerified={handlePinVerified}
            onCancel={handlePinCancel}
          />
        )}
        
        {currentScreen === 'payment' && selectedLocker && (
          <PaymentPage 
            lockerId={selectedLocker.id}
            price={selectedLocker.price || 0}
            weight={selectedLocker.weight || 0}
            onComplete={handlePaymentComplete}
            onCancel={handlePaymentCancel}
          />
        )}
        
        {currentScreen === 'thank-you' && (
          <ThankYouPage 
            processType={processType!}
            generatedPin={lastGeneratedPin}
            transactionId={lastTransactionId} 
            weight={lastWeight} 
            price={lastPrice}   
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}