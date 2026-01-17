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
import { useLockerSystem } from './lockerSystem'; // IMPORTING THE NEW HOOK

type Screen = 
  | 'welcome'
  | 'process-selection'
  | 'dropoff-instructions' // Now comes BEFORE available lockers
  | 'available-lockers'
  | 'weighing-process'     // New screen for the hardware interaction
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

  const selectedLocker = lockers.find(l => l.id === selectedLockerId);

  // --- NAVIGATION HANDLERS ---
  const handleWelcomeNext = () => setCurrentScreen('process-selection');

  const handleProcessSelection = (process: 'dropoff' | 'pickup') => {
    setProcessType(process);
    if (process === 'dropoff') {
      // NEW FLOW: Instructions FIRST
      setCurrentScreen('dropoff-instructions');
    } else {
      setCurrentScreen('pickup-lockers');
    }
  };

  const handleProcessBack = () => setCurrentScreen('welcome');

  // New handler for moving from instructions to locker selection
  const handleInstructionsNext = () => {
    setCurrentScreen('available-lockers');
  };

  const handleInstructionsBack = () => {
    setCurrentScreen('process-selection');
  };

  const handleLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    // Move to the weighing/hardware interaction page
    setCurrentScreen('weighing-process');
  };

  const handleAvailableLockersBack = () => setCurrentScreen('dropoff-instructions');

  const handleDropOffComplete = async (finalPrice: number, finalWeight: number) => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    const newTransactionId = `TRX-${Math.floor(Date.now() / 1000)}`;
    
    setLastGeneratedPin(newPin);
    setLastTransactionId(newTransactionId);

    if (selectedLockerId) {
      try {
        await addDoc(collection(db, "transactions"), {
          transactionId: newTransactionId,
          lockerId: selectedLockerId,
          pin: newPin,
          price: finalPrice,
          weight: finalWeight,
          type: 'dropoff',
          status: 'paid_pending',
          laundryStatus: 'Dropped', 
          timestamp: new Date()
        });
      } catch (e) {
        console.error("Error saving transaction:", e);
      }
    }
    setCurrentScreen('thank-you');
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
        
        {/* NEW FLOW STEP 1: General Instructions */}
        {currentScreen === 'dropoff-instructions' && (
           <DropOffInstructionsPage 
             onNext={handleInstructionsNext}
             onBack={handleInstructionsBack}
           />
        )}
        
        {/* NEW FLOW STEP 2: Pick Locker */}
        {currentScreen === 'available-lockers' && (
          <AvailableLockersPage 
            lockers={lockers.filter(l => l.status === 'available')} 
            onSelectLocker={handleLockerSelect} 
            onBack={handleAvailableLockersBack} 
          />
        )}
        
        {/* NEW FLOW STEP 3: Weighing/Action (renamed from DropOffInstructionsPage usage) */}
        {currentScreen === 'weighing-process' && selectedLockerId && (
          <WeighingPage 
            lockerId={selectedLockerId} 
            currentWeight={lockers.find(l => l.id === selectedLockerId)?.weight || 0}
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
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}