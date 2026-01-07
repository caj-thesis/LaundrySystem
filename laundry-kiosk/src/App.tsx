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
  const [selectedLocker, setSelectedLocker] = useState<number | null>(null);
  const [processType, setProcessType] = useState<'dropoff' | 'pickup' | null>(null);

  const handleWelcomeNext = () => {
    setCurrentScreen('process-selection');
  };

  const handleProcessSelection = (process: 'dropoff' | 'pickup') => {
    setProcessType(process);
    if (process === 'dropoff') {
      setCurrentScreen('available-lockers');
    } else {
      setCurrentScreen('pickup-lockers');
    }
  };

  const handleProcessBack = () => {
    setCurrentScreen('welcome');
  };

  const handleLockerSelect = (lockerId: number) => {
    setSelectedLocker(lockerId);
    setCurrentScreen('dropoff-instructions');
  };

  const handleAvailableLockersBack = () => {
    setCurrentScreen('process-selection');
  };

  const handleDropOffComplete = () => {
    setCurrentScreen('thank-you');
  };

  const handleDropOffBack = () => {
    setCurrentScreen('available-lockers');
  };

  const handlePickupLockerSelect = (lockerId: number) => {
    setSelectedLocker(lockerId);
    setCurrentScreen('pin-entry');
  };

  const handlePickupLockersBack = () => {
    setCurrentScreen('process-selection');
  };

  const handlePinVerified = () => {
    setCurrentScreen('payment');
  };

  const handlePinCancel = () => {
    setCurrentScreen('pickup-lockers');
  };

  const handlePaymentCancel = () => {
    setCurrentScreen('pickup-lockers');
  };

  const handlePaymentComplete = () => {
    setCurrentScreen('thank-you');
  };

  const handleReset = () => {
    setCurrentScreen('welcome');
    setSelectedLocker(null);
    setProcessType(null);
  };

  return (
    <div className="app-container">
      <div className="kiosk-screen">
        {currentScreen === 'welcome' && (
          <WelcomePage onNext={handleWelcomeNext} />
        )}
        {currentScreen === 'process-selection' && (
          <ProcessSelectionPage onSelect={handleProcessSelection} onBack={handleProcessBack} />
        )}
        {currentScreen === 'available-lockers' && (
          <AvailableLockersPage onSelectLocker={handleLockerSelect} onBack={handleAvailableLockersBack} />
        )}
        {currentScreen === 'dropoff-instructions' && selectedLocker && (
          <DropOffInstructionsPage 
            lockerId={selectedLocker} 
            onComplete={handleDropOffComplete}
            onBack={handleDropOffBack}
          />
        )}
        {currentScreen === 'pickup-lockers' && (
          <PickupLockersPage onSelectLocker={handlePickupLockerSelect} onBack={handlePickupLockersBack} />
        )}
        {currentScreen === 'pin-entry' && selectedLocker && (
          <PinCodePage 
            lockerId={selectedLocker}
            onVerified={handlePinVerified}
            onCancel={handlePinCancel}
          />
        )}
        {currentScreen === 'payment' && selectedLocker && (
          <PaymentPage 
            lockerId={selectedLocker}
            onComplete={handlePaymentComplete}
            onCancel={handlePaymentCancel}
          />
        )}
        {currentScreen === 'thank-you' && (
          <ThankYouPage 
            processType={processType!}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}