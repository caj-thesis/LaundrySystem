import { useState, useEffect } from 'react';
import { WelcomePage } from './components/WelcomePage';
import { ProcessSelectionPage } from './components/ProcessSelectionPage';
import { AvailableLockersPage } from './components/AvailableLockersPage';
import { DropOffInstructionsPage } from './components/DropOffInstructionsPage';
import { PickupLockersPage } from './components/PickupLockersPage';
import { PinCodePage } from './components/PinCodePage';
import { PaymentPage } from './components/PaymentPage';
import { ThankYouPage } from './components/ThankYouPage';
import './styles/app.css';

export interface Locker {
  id: number;
  size: 'Small' | 'Medium' | 'Large';
  capacity: string;
  status: 'available' | 'occupied';
  weight?: number; 
  price?: number;  
  readyTime?: string;
  pin?: string; 
  doorStatus?: string; // Added to track physical door state
}

// --- INITIAL STATE ---
// We keep this structure, but "weight" and "doorStatus" will be overwritten by live data
const INITIAL_LOCKERS: Locker[] = [
  { id: 1, size: 'Medium', capacity: '10 kg', status: 'available', weight: 0, doorStatus: 'CLOSED' },
  { id: 2, size: 'Medium', capacity: '10 kg', status: 'occupied', weight: 3, price: 75, readyTime: '2 hours ago', pin: '1234', doorStatus: 'CLOSED' },
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

  // --- POLLING EFFECT (THE FIX) ---
  useEffect(() => {
    const fetchHardwareStatus = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/status');
        const data = await response.json();
        
        // Example data structure from server:
        // { l1: { door: 'OPEN', weight: 0.5 }, l2: { door: 'CLOSED', weight: 0.0 }, credit: 10 }

        setLockers(prevLockers => prevLockers.map(locker => {
          // Map backend data to frontend locker IDs
          let hardwareData = null;
          if (locker.id === 1) hardwareData = data.l1;
          if (locker.id === 2) hardwareData = data.l2;

          if (hardwareData) {
            return {
              ...locker,
              // Always update weight from sensor
              weight: hardwareData.weight, 
              // Always update door status
              doorStatus: hardwareData.door 
            };
          }
          return locker;
        }));
      } catch (error) {
        console.error("Hardware disconnected:", error);
      }
    };

    // Run immediately then every 1 second
    fetchHardwareStatus();
    const intervalId = setInterval(fetchHardwareStatus, 1000);

    return () => clearInterval(intervalId);
  }, []); // Empty dependency array = runs on mount

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

  const handleDropOffComplete = (finalPrice: number, finalWeight: number) => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    setLastGeneratedPin(newPin);

    if (selectedLockerId) {
      setLockers(prev => prev.map(locker => {
        if (locker.id === selectedLockerId) {
          return {
            ...locker,
            status: 'occupied',
            // Note: We don't hardcode weight here anymore because the polling updates it,
            // but we save the price calculated at this moment.
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
    if (selectedLockerId) {
      try {
        // Send unlock command to Arduino
        await fetch('http://localhost:3000/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId })
        }).catch(err => console.error("Unlock failed:", err));

        // Reset locker status in UI
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

  const handleReset = () => {
    setCurrentScreen('welcome');
    setSelectedLockerId(null);
    setProcessType(null);
    setLastGeneratedPin(null);
  };

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
            // Pass the live weight from polling so the user sees it update
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