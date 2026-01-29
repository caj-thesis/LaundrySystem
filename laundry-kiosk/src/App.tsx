import { useState, useCallback } from 'react';
import { WelcomePage } from './components/WelcomePage';
import { ProcessSelectionPage } from './components/ProcessSelectionPage';
import { AvailableLockersPage } from './components/AvailableLockersPage';
import { DropOffInstructionsPage } from './components/DropOffInstructionsPage';
import { WeighingPage } from './components/WeighingPage';
import { PickupLockersPage } from './components/PickupLockersPage';
import { PinCodePage } from './components/PinCodePage';
import { PaymentPage } from './components/PaymentPage';
import { ThankYouPage } from './components/ThankYouPage';
import './styles/app.css';
// Logic and Types
import { db } from '../firebaseConfig'; 
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from 'firebase/firestore'; 
import { useLockerSystem } from './lockerSystem'; 

type Screen = 
  | 'welcome'
  | 'process-selection'
  | 'dropoff-instructions'
  | 'available-lockers'
  | 'weighing-process'
  | 'pickup-lockers'
  | 'pin-entry'
  | 'payment'
  | 'thank-you';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('welcome');
  const [selectedLockerId, setSelectedLockerId] = useState<number | null>(null);
  const [processType, setProcessType] = useState<'dropoff' | 'pickup' | null>(null);
  
  // Use the centralized hook for locker state
  const { lockers } = useLockerSystem();

  const [lastGeneratedPin, setLastGeneratedPin] = useState<string | null>(null);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [lastWeight, setLastWeight] = useState<number>(0); // NEW
  const [lastPrice, setLastPrice] = useState<number>(0);   // NEW

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
    setCurrentScreen('weighing-process');
  };

  const handleAvailableLockersBack = () => setCurrentScreen('dropoff-instructions');

  // --- UPDATED: Now accepts customerPhone ---
  // App.tsx
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
      await fetch('http://localhost:3000/api/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId: selectedLockerId }),
      });

      await addDoc(collection(db, "transactions"), {
        transactionId: newTransactionId,
        lockerId: selectedLockerId,
        pin: newPin,
        price: finalPrice,
        weight: finalWeight,
        phoneNumber: phoneNumber || "N/A", 
        type: 'dropoff',
        status: 'paid_pending',
        laundryStatus: 'Pending', 
        timestamp: new Date()
      });
    } catch (e) {
      console.error("Data was not saved to cloud:", e);
    }
  }
};
  const handleWeighingBack = () => setCurrentScreen('available-lockers');

  const handlePickupLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    setCurrentScreen('pin-entry');
  };

  const handlePickupLockersBack = () => setCurrentScreen('process-selection');

  const handlePinVerified = () => setCurrentScreen('payment');

  const handlePinCancel = () => setCurrentScreen('pickup-lockers');

  const handlePaymentCancel = () => setCurrentScreen('pickup-lockers');

  const handlePaymentComplete = async () => {
    const paymentId = `PAY-${Math.floor(Date.now() / 1000)}`;
    setLastTransactionId(paymentId);

    // CRITICAL: Capture the locker info before resetting
  if (selectedLocker) {
    setLastWeight(selectedLocker.weight || 0);
    setLastPrice(selectedLocker.price || 0);
  }

    if (selectedLockerId) {
      try {
        await fetch('http://localhost:3000/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId })
        }).catch(err => console.error("Unlock failed:", err));

        const q = query(
          collection(db, "transactions"),
          where("lockerId", "==", selectedLockerId),
          where("status", "==", "paid_pending")
        );

        const querySnapshot = await getDocs(q);
        querySnapshot.forEach(async (document) => {
          const transactionRef = doc(db, "transactions", document.id);
          await updateDoc(transactionRef, {
            status: 'completed',
            pickedUpAt: new Date(),
            paymentId: paymentId
          });
        });

      } catch (e) {
        console.error("Error completing payment:", e);
      }
    }
    setCurrentScreen('thank-you');
  };

  const handleReset = useCallback(() => {
    setCurrentScreen('welcome');
    setSelectedLockerId(null);
    setProcessType(null);
    setLastGeneratedPin(null);
    setLastTransactionId(null);
  }, []);

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
        
        {/* WEIGHING PROCESS - Passes the updated handler */}
        {currentScreen === 'weighing-process' && selectedLockerId && (
          <WeighingPage 
            lockerId={selectedLockerId} 
            currentWeight={lockers.find(l => l.id === selectedLockerId)?.weight || 0}
            // @ts-ignore - Ignoring type check if WeighingPage definition hasn't been updated yet
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
            weight={lastWeight} // Pass stored weight
             price={lastPrice}   // Pass stored price
            onReset={handleReset}
          />
        )}
      </div>
    
    </div>
  );
 
}

