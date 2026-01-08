import { useState, useEffect, useCallback } from 'react';
import { WelcomePage } from './components/WelcomePage';
import { ProcessSelectionPage } from './components/ProcessSelectionPage';
import { AvailableLockersPage } from './components/AvailableLockersPage';
import { DropOffInstructionsPage } from './components/DropOffInstructionsPage';
import { PickupLockersPage } from './components/PickupLockersPage';
import { PinCodePage } from './components/PinCodePage';
import { PaymentPage } from './components/PaymentPage';
import { ThankYouPage } from './components/ThankYouPage';
import { Toaster, toast } from 'sonner';
import type { Locker } from './types'; // <--- IMPORT FROM TYPES FILE
import './styles/app.css';

// --- INITIAL STATE ---
const INITIAL_LOCKERS: Locker[] = [
  { id: 1, size: 'Medium', capacity: '15 kg', status: 'available', weight: 0, doorStatus: 'CLOSED' },
  { id: 2, size: 'Large',  capacity: '20 kg', status: 'occupied', weight: 3, price: 75, readyTime: '2 hours ago', pin: '1234', doorStatus: 'CLOSED' },
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

  const selectedLocker = lockers.find(l => l.id === selectedLockerId);

  // --- HELPER: UNLOCK COMMAND ---
  const unlockLocker = async (id: number) => {
    try {
      console.log(`Attempting to unlock Locker ${id}...`);
      // Fire and forget (don't await response in UI thread to prevent freeze)
      fetch('http://localhost:3000/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId: id })
      }).then(res => {
          if(res.ok) toast.success(`Locker ${id} Unlocked`);
          else toast.error("Unlock failed");
      });
    } catch (error) {
      console.error("Failed to trigger unlock:", error);
    }
  };

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
        // Silent fail
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
    unlockLocker(lockerId); // Trigger unlock immediately
    setCurrentScreen('dropoff-instructions');
  };

  const handleAvailableLockersBack = () => setCurrentScreen('process-selection');

  const handleDropOffComplete = (finalPrice: number, finalWeight: number) => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    setLastGeneratedPin(newPin);

    if (selectedLockerId) {
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

  const handlePaymentComplete = () => {
    if (selectedLockerId) {
      unlockLocker(selectedLockerId); // Unlock for pickup

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
    }
    setCurrentScreen('thank-you');
  };

  const handleReset = useCallback(() => {
    setCurrentScreen('welcome');
    setSelectedLockerId(null);
    setProcessType(null);
    setLastGeneratedPin(null);
  }, []);

  return (
    <div className="app-container">
      <Toaster position="top-center" />
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
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}