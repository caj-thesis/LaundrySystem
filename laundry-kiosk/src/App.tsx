import { useState } from 'react';
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
}

// --- INITIAL STATE ---
// Locker 1: Available
// Locker 2: Occupied (Default PIN "1234")
const INITIAL_LOCKERS: Locker[] = [
  { id: 1, size: 'Medium', capacity: '10 kg', status: 'available' },
  { id: 2, size: 'Medium', capacity: '10 kg', status: 'occupied', weight: 4.5, price: 112.5, readyTime: '2 hours ago', pin: '1234' },
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

  // UPDATED: Now accepts dynamic Price and Weight
  const handleDropOffComplete = (finalPrice: number, finalWeight: number) => {
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    setLastGeneratedPin(newPin);

    if (selectedLockerId) {
      setLockers(prev => prev.map(locker => {
        if (locker.id === selectedLockerId) {
          return {
            ...locker,
            status: 'occupied',
            weight: finalWeight, // Use actual weight
            price: finalPrice,   // Use actual calculated price
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
        await fetch('http://localhost:3000/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId })
        }).catch(err => console.error("Unlock failed:", err));

        setLockers(prev => prev.map(locker => {
          if (locker.id === selectedLockerId) {
            return {
              ...locker,
              status: 'available',
              weight: undefined, 
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
            onComplete={handleDropOffComplete} // Connects to the updated function
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