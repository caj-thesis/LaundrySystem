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

// --- FIREBASE IMPORTS ---
import { db, auth } from '../firebaseConfig'; 
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
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
  const [shopName, setShopName] = useState<string>("CAJ Laundry Locker System"); 

  const [selectedPricePerKg, setSelectedPricePerKg] = useState<number>(25);
  const [selectedLaundryType, setSelectedLaundryType] = useState<string>('Clothes');

  const { lockers } = useLockerSystem();

  const [lastGeneratedPin, setLastGeneratedPin] = useState<string | null>(null);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [lastWeight, setLastWeight] = useState<number>(0); 
  const [lastPrice, setLastPrice] = useState<number>(0);   

  const selectedLocker = lockers.find(l => l.id === selectedLockerId);

  // --- 2. AUTHENTICATION LISTENER (SYSTEM LOGIN) ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log("✅ System Authenticated:", user.uid); 
      } else {
        console.log("⚠️ System not signed in. Signing in now..."); 
        signInAnonymously(auth).catch((error) => {
          console.error("❌ Auth Error:", error);
          alert("System Error: Could not sign in to database. Check internet.");
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // --- 3. SETTINGS LISTENER (General + Pricing) ---
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "general"), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        console.log("✅ Settings Update:", data);
        
        // Update Shop Name
        if (data.laundryShopName) {
            setShopName(data.laundryShopName);
        }

        // Update Pricing (Check for fields, default if missing)
        setPricing({
          clothesPrice: data.clothesPrice !== undefined ? data.clothesPrice : 25,
          bedSheetPrice: data.bedSheetPrice !== undefined ? data.bedSheetPrice : 40
        });
      }
    });
    return () => unsub();
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
      // 3. Hardware Lock (Non-blocking)
      fetch('http://localhost:3000/api/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId: selectedLockerId }),
      }).catch(e => console.error("Hardware Error:", e));

      // 4. CREATE TRANSACTION (Wait for this to finish!)
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
        laundryStatus: 'Dropped', 
        
        triggerReminder: false,
        reminderSent: false,
        
        triggerPrint: true, 

        timestamp: new Date()
      });

      // 5. Update Locker Status
      await updateDoc(doc(db, "lockers", String(selectedLockerId)), { 
        status: 'occupied',
        currentTransactionId: newTransactionId 
      });

      // 6. SUCCESS: Now render the Thank You page
      setCurrentScreen('thank-you');

    } catch (e) {
      console.error("CRITICAL ERROR SAVING DATA:", e);
      // 7. Alert the user if something goes wrong
      alert("Failed to save transaction. Please check your internet connection.");
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

        // 6. SUCCESS: Move to Thank You screen ONLY after updates succeed
        setCurrentScreen('thank-you');

      } catch (e) {
        console.error("Error completing payment:", e);
        alert("Payment recorded locally, but failed to sync. Please check connection.");
        // Still show thank you to user since they paid
        setCurrentScreen('thank-you'); 
      }
    } else {
        // Fallback if no locker selected
        setCurrentScreen('thank-you');
    }
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
        {currentScreen === 'welcome' && <WelcomePage onNext={handleWelcomeNext} shopName={shopName} />}
        
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
            doorStatus={lockers.find(l => l.id === selectedLockerId)?.doorStatus || 'CLOSED'}
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