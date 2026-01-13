import { useState, useEffect, useCallback } from 'react';
import { WelcomePage } from './components/WelcomePage';
import { ProcessSelectionPage } from './components/ProcessSelectionPage';
import { AvailableLockersPage } from './components/AvailableLockersPage';
import { DropOffInstructionsPage } from './components/DropOffInstructionsPage';
import { PickupLockersPage } from './components/PickupLockersPage';
import { PinCodePage } from './components/PinCodePage';
import { PaymentPage } from './components/PaymentPage';
import { ThankYouPage } from './components/ThankYouPage';
import type { Locker } from './types'; 
import './styles/app.css';
import { db } from '../firebaseConfig'; 
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from 'firebase/firestore'; 

const INITIAL_LOCKERS: Locker[] = [
  { id: 1,  capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED' },
  { id: 2,  capacity: '20 kg', status: 'available', weight: 0, doorStatus: 'CLOSED' },
];

type Screen = 
  | 'welcome'
  | 'process-selection'
  | 'available-lockers'
  | 'dropoff-instructions'
  | 'pickup-lockers'
  | 'pin-entry'
  | 'payment'
  | 'thank-you';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('welcome');
  const [selectedLockerId, setSelectedLockerId] = useState<number | null>(null);
  const [processType, setProcessType] = useState<'dropoff' | 'pickup' | null>(null);
  const [lockers, setLockers] = useState<Locker[]>(INITIAL_LOCKERS);
  const [lastGeneratedPin, setLastGeneratedPin] = useState<string | null>(null);
  // NEW: State to hold the transaction ID
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);

  const selectedLocker = lockers.find(l => l.id === selectedLockerId);

  // --- POLLING EFFECT ---
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
        console.error("Hardware disconnected:", error);
      }
    };

    fetchHardwareStatus();
    const intervalId = setInterval(fetchHardwareStatus, 1000);
    return () => clearInterval(intervalId);
  }, []);

  // --- NAVIGATION HANDLERS ---
  const handleWelcomeNext = () => setCurrentScreen('process-selection');

  const handleProcessSelection = (process: 'dropoff' | 'pickup') => {
    setProcessType(process);
    setCurrentScreen(process === 'dropoff' ? 'available-lockers' : 'pickup-lockers');
  };

  const handleProcessBack = () => setCurrentScreen('welcome');

  const handleLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    setCurrentScreen('dropoff-instructions');
  };

  const handleAvailableLockersBack = () => setCurrentScreen('process-selection');

  const handleDropOffComplete = async (finalPrice: number, finalWeight: number) => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    // NEW: Generate Transaction ID (e.g., TRX-173684123)
    const newTransactionId = `TRX-${Math.floor(Date.now() / 1000)}`;
    
    setLastGeneratedPin(newPin);
    setLastTransactionId(newTransactionId);

    if (selectedLockerId) {
      try {
        await addDoc(collection(db, "transactions"), {
          transactionId: newTransactionId, // Save to DB
          lockerId: selectedLockerId,
          pin: newPin,
          price: finalPrice,
          weight: finalWeight,
          type: 'dropoff',
          status: 'paid_pending',
          timestamp: new Date()
        });
      } catch (e) {
        console.error("Error saving transaction:", e);
      }

      setLockers(prev => prev.map(locker => {
        if (locker.id === selectedLockerId) {
          return {
            ...locker,
            status: 'occupied',
            price: finalPrice,   
            readyTime: 'Processing...',
            pin: newPin
          };
        }
        return locker;
      }));
    }
    setCurrentScreen('thank-you');
  };

  const handleDropOffBack = () => setCurrentScreen('available-lockers');

  const handlePickupLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    setCurrentScreen('pin-entry');
  };

  const handlePickupLockersBack = () => setCurrentScreen('process-selection');

  const handlePinVerified = () => setCurrentScreen('payment');

  const handlePinCancel = () => setCurrentScreen('pickup-lockers');

  const handlePaymentCancel = () => setCurrentScreen('pickup-lockers');

  const handlePaymentComplete = async () => {
    // NEW: Generate Payment Receipt ID
    const paymentId = `PAY-${Math.floor(Date.now() / 1000)}`;
    setLastTransactionId(paymentId);

    if (selectedLockerId) {
      try {
        await fetch('http://localhost:3000/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId })
        }).catch(err => console.error("Unlock failed:", err));

        // Update Firebase
        try {
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
              paymentId: paymentId // Save payment reference
            });
          });
        } catch (dbError) {
          console.error("Error updating Firebase status:", dbError);
        }

        setLockers(prev => prev.map(locker => {
          if (locker.id === selectedLockerId) {
            return {
              ...locker,
              status: 'available',
              price: undefined,
              readyTime: undefined,
              pin: undefined
            };
          }
          return locker;
        }));
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
    setLastTransactionId(null); // Reset ID
  }, []);

  return (
    <div className="app-container">
      <div className="kiosk-screen">
        {currentScreen === 'welcome' && <WelcomePage onNext={handleWelcomeNext} />}
        
        {currentScreen === 'process-selection' && (
          <ProcessSelectionPage onSelect={handleProcessSelection} onBack={handleProcessBack} />
        )}
        
        {currentScreen === 'available-lockers' && (
          <AvailableLockersPage 
            lockers={lockers.filter(l => l.status === 'available')} 
            onSelectLocker={handleLockerSelect} 
            onBack={handleAvailableLockersBack} 
          />
        )}
        
        {currentScreen === 'dropoff-instructions' && selectedLockerId && (
          <DropOffInstructionsPage 
            lockerId={selectedLockerId} 
            currentWeight={lockers.find(l => l.id === selectedLockerId)?.weight || 0}
            onComplete={handleDropOffComplete} 
            onBack={handleDropOffBack}
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
            transactionId={lastTransactionId} // Pass to component
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}