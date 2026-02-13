import { useState, useCallback, useEffect } from 'react';
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
  doc,
  onSnapshot 
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
  
  // --- 1. DYNAMIC PRICING & SETTINGS STATE ---
  const [pricing, setPricing] = useState({ clothesPrice: 25, bedSheetPrice: 40 });
  // Default fallback name
  const [shopName, setShopName] = useState<string>("CAJ Laundry Locker System"); 

  const [selectedPricePerKg, setSelectedPricePerKg] = useState<number>(25);
  const [selectedLaundryType, setSelectedLaundryType] = useState<string>('Clothes');

  const { lockers } = useLockerSystem();

  const [lastGeneratedPin, setLastGeneratedPin] = useState<string | null>(null);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [lastWeight, setLastWeight] = useState<number>(0); 
  const [lastPrice, setLastPrice] = useState<number>(0);   

  const selectedLocker = lockers.find(l => l.id === selectedLockerId);

  // --- 2. LISTENER FOR PRICING ---
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "pricing"), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        console.log("✅ Pricing fetched:", data);
        setPricing({
          clothesPrice: data.clothesPrice || 25,
          bedSheetPrice: data.bedSheetPrice || 40
        });
      }
    });
    return () => unsub();
  }, []);

  // --- 3. LISTENER FOR GENERAL SETTINGS (Shop Name) ---
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "general"), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        console.log("✅ General Settings fetched:", data);
        if (data.laundryShopName) {
            setShopName(data.laundryShopName);
        }
      }
    });
    return () => unsub();
  }, []);

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

  const handleLaundryTypeSelect = (price: number, type: string) => {
    setSelectedPricePerKg(price);
    setSelectedLaundryType(type); 
    setCurrentScreen('weighing-process');
  };

  const handleLaundryTypeBack = () => {
    setCurrentScreen('available-lockers');
  };

  const handleAvailableLockersBack = () => setCurrentScreen('dropoff-instructions');

  // --- HANDLE DROP OFF ---
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
        fetch('http://localhost:3000/api/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId }),
        }).catch(e => console.error("Hardware Error:", e));

        // --- 4. CREATE TRANSACTION ---
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
          
          triggerReminder: false,
          reminderSent: false,
          
          triggerPrint: true, 

          timestamp: new Date()
        });

        await updateDoc(doc(db, "lockers", String(selectedLockerId)), { 
          status: 'occupied',
          currentTransactionId: newTransactionId 
        });

      } catch (e) {
        console.error("CRITICAL ERROR SAVING DATA:", e);
      }
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
        fetch('http://localhost:3000/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId: selectedLockerId })
        }).catch(err => console.error("Unlock failed:", err));

        // --- 5. UPDATE TRANSACTION ---
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
            paymentId: paymentId,
            triggerPrint: true
          })
        );
        await Promise.all(updates);

        await updateDoc(doc(db, "lockers", String(selectedLockerId)), { 
          status: 'available',
          currentTransactionId: null 
        });

      } catch (e) {
        console.error("Error completing payment:", e);
      }
    }
    setCurrentScreen('thank-you');
  };

  const handleReset = useCallback(() => {
    if (processType === 'pickup' && selectedLockerId) {
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
    setSelectedPricePerKg(25);
    setSelectedLaundryType('Clothes');
  }, [processType, selectedLockerId]);

  return (
    <div className="app-container">
      <div className="kiosk-screen">
        {/* Pass the dynamic shopName to the WelcomePage */}
        {currentScreen === 'welcome' && <WelcomePage onNext={handleWelcomeNext} shopName={shopName} />}
        
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

        {/* --- 6. PASS PRICING TO SELECTION PAGE --- */}
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