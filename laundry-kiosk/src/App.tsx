import { useState, useCallback, useEffect } from 'react';
import { WelcomePage } from './components/WelcomePage';
import { ProcessSelectionPage } from './components/ProcessSelectionPage';
import { AvailableLockersPage } from './components/AvailableLockersPage';
import { LaundryTypeSelectionPage } from './components/LaundryTypeSelectionPage'; 
import { WeighingPage } from './components/WeighingPage';
import { PickupLockersPage } from './components/PickupLockersPage';
import { PinCodePage } from './components/PinCodePage';
import { PaymentPage } from './components/PaymentPage';
import { ThankYouPage } from './components/ThankYouPage';
import './styles/app.css';

import { useLockerSystem } from './lockerSystem'; 

type Screen = 
  | 'welcome'
  | 'process-selection'
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
  
  // --- 1. DYNAMIC PRICING & SETTINGS STATE ---
  const [pricing, setPricing] = useState({ 
    clothesPrice: 25, 
    bedSheetPrice: 40, 
    minClothesPrice: 50, 
    minBedSheetPrice: 50 
  });
  const [shopName, setShopName] = useState<string>("CAJ Laundry Locker System");

  const [selectedPricePerKg, setSelectedPricePerKg] = useState<number>(25);
  const [selectedLaundryType, setSelectedLaundryType] = useState<string>('Clothes');

  const { lockers } = useLockerSystem();
  const connectedLockers = lockers.filter((locker) => locker.isConnected !== false);
  const activeLockers = connectedLockers.length > 0 ? connectedLockers : lockers;

  const [lastGeneratedPin, setLastGeneratedPin] = useState<string | null>(null);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [lastWeight, setLastWeight] = useState<number>(0); 
  const [lastPrice, setLastPrice] = useState<number>(0);   

  const selectedLocker = lockers.find(l => l.id === selectedLockerId);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/settings');
        if (!response.ok) return;
        const data = await response.json();

        if (data.laundryShopName) setShopName(data.laundryShopName);
        setPricing({
          clothesPrice: data.clothesPrice !== undefined ? data.clothesPrice : 25,
          bedSheetPrice: data.bedSheetPrice !== undefined ? data.bedSheetPrice : 40,
          minClothesPrice: data.minClothesPrice !== undefined ? data.minClothesPrice : 50,     
          minBedSheetPrice: data.minBedSheetPrice !== undefined ? data.minBedSheetPrice : 50   
        });
      } catch (error) {
        // Keep defaults in offline mode
      }
    };

    fetchSettings();
    const interval = setInterval(fetchSettings, 5000);
    return () => clearInterval(interval);
  }, []);



  // --- NAVIGATION HANDLERS ---
  const handleWelcomeNext = () => setCurrentScreen('process-selection');

  const handleProcessSelection = (process: 'dropoff' | 'pickup') => {
    setProcessType(process);
    if (process === 'dropoff') {
      setCurrentScreen('available-lockers');
    } else {
      setCurrentScreen('pickup-lockers');
    }
  };

  const handleProcessBack = () => setCurrentScreen('welcome');

  const handleLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    setCurrentScreen('laundry-type-selection');
  };

  const handleLaundryTypeSelect = (price: number, type: string) => {
    setSelectedPricePerKg(price);
    setSelectedLaundryType(type); 
    setCurrentScreen('weighing-process');
  };

  const handleLaundryTypeBack = () => {
    setCurrentScreen('available-lockers');
  };

  const handleAvailableLockersBack = () => setCurrentScreen('process-selection');

  // --- HANDLE DROP OFF ---
  const handleDropOffComplete = async (finalPrice: number, finalWeight: number, phoneNumber?: string) => { 
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    const newTransactionId = `TRX-${Math.floor(Date.now() / 1000)}`;
    
    // 1. Set the data for the Thank You page (don't navigate yet)
    setLastGeneratedPin(newPin);
    setLastTransactionId(newTransactionId);
    setLastWeight(finalWeight);
    setLastPrice(finalPrice);

    // 2. Check for Locker ID
    if (!selectedLockerId) {
      console.error("No locker selected!");
      alert("Error: No locker selected. Please try again.");
      return;
    }

    try {
      // 3. Save local transaction first, then server syncs to Firebase when available
      // Backend already applies local lock action, so no separate /api/lock request is needed here.
      await fetch('http://localhost:3000/api/dropoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: newTransactionId,
          lockerId: selectedLockerId,
          pin: newPin,
          price: finalPrice,
          weight: finalWeight,
          pricePerKg: selectedPricePerKg,
          phoneNumber: phoneNumber || 'N/A',
          type: selectedLaundryType,
          status: 'Pending',
          laundryStatus: 'Dropped',
          triggerReminder: false,
          reminderSent: false,
          triggerPrint: true,
          droppedAt: new Date()
        })
      });

      // 6. SUCCESS: Now render the Thank You page
      setCurrentScreen('thank-you');

    } catch (e) {
      console.error("CRITICAL ERROR SAVING DATA:", e);
      // 7. Alert the user if something goes wrong
      alert("Failed to save local transaction. Please check kiosk service.");
    }
  };

  const handleWeighingBack = () => setCurrentScreen('laundry-type-selection');
  
  const handlePickupLockerSelect = (lockerId: number) => {
    setSelectedLockerId(lockerId);
    setCurrentScreen('pin-entry');
  };

  const handlePickupLockersBack = () => setCurrentScreen('process-selection');
  const handlePinVerified = () => setCurrentScreen('payment');
  const handlePinCancel = () => setCurrentScreen('pickup-lockers');
  const handlePaymentCancel = () => setCurrentScreen('pickup-lockers');

  // --- HANDLE PICKUP ---
  const handlePaymentComplete = async () => {
    const paymentId = `PAY-${Math.floor(Date.now() / 1000)}`;
    setLastTransactionId(paymentId);

    if (selectedLocker) {
      setLastWeight(selectedLocker.weight || 0);
      setLastPrice(selectedLocker.price || 0);
    }

    if (selectedLockerId) {
      try {
        // --- 5. UPDATE TRANSACTION (local-first) ---
        // Backend already applies local unlock action, so no separate /api/unlock request is needed here.
        await fetch('http://localhost:3000/api/pickup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId, paymentId })
        });

        // 6. SUCCESS: Move to Thank You screen ONLY after updates succeed
        setCurrentScreen('thank-you');

      } catch (e) {
        console.error("Error completing payment:", e);
        alert("Payment completed, but local sync service had an issue.");
        // Still show thank you to user since they paid
        setCurrentScreen('thank-you'); 
      }
    } else {
        // Fallback if no locker selected
        setCurrentScreen('thank-you');
    }
  };

  const handleReset = useCallback(() => {
    if (selectedLockerId && (processType === 'pickup' || processType === 'dropoff')) {
      const lockRequest = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId: selectedLockerId }),
      };

      fetch('http://localhost:3000/api/lock', lockRequest)
        .catch(() => fetch('http://localhost:3000/api/lock', lockRequest))
        .catch(e => console.error("Auto-lock failed:", e));
    }

    setCurrentScreen('welcome');
    setSelectedLockerId(null);
    setProcessType(null);
    setLastGeneratedPin(null);
    setLastTransactionId(null);
    setSelectedPricePerKg(25);
    setSelectedLaundryType('Clothes');
  }, [processType, selectedLockerId]);

  return (
    <div className="app-container">
      <div className="kiosk-screen">
        {currentScreen === 'welcome' && <WelcomePage onNext={handleWelcomeNext} shopName={shopName} />}
        
        {currentScreen === 'process-selection' && (
          <ProcessSelectionPage onSelect={handleProcessSelection} onBack={handleProcessBack} />
        )}
        
        {currentScreen === 'available-lockers' && (
          <AvailableLockersPage 
            lockers={activeLockers.filter((locker) => locker.status === 'available')} 
            onSelectLocker={handleLockerSelect} 
            onBack={handleAvailableLockersBack} 
          />
        )}

        {currentScreen === 'laundry-type-selection' && (
          <LaundryTypeSelectionPage 
            onSelect={handleLaundryTypeSelect}
            onBack={handleLaundryTypeBack}
            pricing={pricing}
          />
        )}
        
        {currentScreen === 'weighing-process' && selectedLockerId && (
          <WeighingPage 
            lockerId={selectedLockerId} 
            currentWeight={lockers.find(l => l.id === selectedLockerId)?.weight || 0}
            pricePerKg={selectedPricePerKg}
            minimumPrice={selectedLaundryType === 'Clothes' ? pricing.minClothesPrice : pricing.minBedSheetPrice} 
            doorStatus={lockers.find(l => l.id === selectedLockerId)?.doorStatus || 'CLOSED'}
            onComplete={handleDropOffComplete} 
            onBack={handleWeighingBack}
          />
        )}
        
        {currentScreen === 'pickup-lockers' && (
          <PickupLockersPage 
            lockers={activeLockers.filter((locker) => locker.status === 'occupied')} 
            onSelectLocker={handlePickupLockerSelect} 
            onBack={handlePickupLockersBack} 
          />
        )}
        
        {currentScreen === 'pin-entry' && selectedLocker && (
          <PinCodePage 
            lockerId={selectedLocker.id}
            correctPin={selectedLocker.pin || '0000'}
            transactionId={selectedLocker.currentTransactionId}
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
