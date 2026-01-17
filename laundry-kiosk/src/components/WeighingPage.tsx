import { useState, useEffect } from 'react';
import { Scale, PhilippinePeso, Loader2, ArrowLeft, Lock, DoorOpen, Info } from 'lucide-react';

interface WeighingPageProps {
  lockerId: number;
  currentWeight: number; 
  onComplete: (price: number, weight: number) => void;
  onBack: () => void;
}

export function WeighingPage({ lockerId, currentWeight, onComplete, onBack }: WeighingPageProps) {
  const [step, setStep] = useState<'opening' | 'unlocked' | 'weighing' | 'summary'>('opening');

  const pricePerKg = 25;
  const totalPrice = currentWeight * pricePerKg;

  // 1. Auto-Unlock on Mount
  useEffect(() => {
    const unlockSequence = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 800)); 
        await fetch('http://localhost:3000/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lockerId }),
        });
        setStep('unlocked');
      } catch (err) {
        console.error("Unlock error:", err);
        setStep('unlocked');
      }
    };

    if (step === 'opening') {
      unlockSequence();
    }
  }, [lockerId, step]);

  // 2. Handle User Confirmation ("Lock & Pay")
  const handleLock = () => {
    setStep('weighing');
  };

  // 3. Simulate Locking & Final Weighing
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === 'weighing') {
      timer = setTimeout(() => {
        setStep('summary');
      }, 2500); 
    }
    return () => clearTimeout(timer);
  }, [step]);

  // --- RENDER: STEP 1 - OPENING ---
  if (step === 'opening') {
    return (
      <div className="weighing-page" style={{ flexDirection: 'column', gap: '1.5rem' }}>
         <div className="status-circle animate-pulse" style={{ marginBottom: '0' }}>
            <DoorOpen size={48} className="text-blue-500" />
         </div>
         <div style={{ textAlign: 'center' }}>
            <h2 className="text-xl font-bold text-gray-700">Unlocking Locker {lockerId}...</h2>
            <p className="text-gray-500 text-sm mt-2">Please wait while the door opens.</p>
         </div>
      </div>
    );
  }

  // --- RENDER: STEP 2 - UNLOCKED (Live Scale View) ---
  if (step === 'unlocked') {
    return (
      <div className="weighing-page" style={{ flexDirection: 'column', justifyContent: 'flex-start', padding: '0', height: '100%', position: 'relative' }}>
        
        {/* Header Section */}
        <div className="page-header" style={{ marginTop: '24px', marginBottom: '16px' }}>
           <h2 className="page-title">Locker {lockerId} Open</h2>
           <p className="page-subtitle">Place your laundry inside.</p>
        </div>

        {/* Return Button */}
        <button onClick={onBack} className="btn-return-top">
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

        {/* Live Weight Content */}
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          width: '100%',
          padding: '0 24px'
        }}>
          
          {/* Status Badge */}
          <div className="bg-green-100 text-green-700 px-4 py-2 rounded-full flex items-center gap-2 font-medium mb-8">
            <DoorOpen size={20} />
            <span>Door Unlocked</span>
          </div>

          {/* SINGLE COMBINED CARD - IMPORTANT HIGHLIGHT */}
          <div className="bg-amber-50 rounded-3xl p-10 w-full max-w-5xl shadow-xl border-2 border-amber-200 flex items-center justify-around gap-8 mb-8">
             
             {/* Weight Section */}
             <div className="flex flex-col items-center gap-4 flex-1">
                <div className="flex items-center gap-3 text-amber-700 font-bold uppercase tracking-wide text-lg mb-1">
                   <Scale size={32} />
                   <span>Current Weight</span>
                </div>
                <div className="text-7xl font-bold text-gray-800 tracking-tight whitespace-nowrap">
                   {currentWeight.toFixed(1)} <span className="text-4xl text-gray-500 font-medium">kg</span>
                </div>
             </div>

             {/* Divider */}
             <div className="w-1 h-32 bg-amber-200/60 rounded-full"></div>

             {/* Price Section */}
             <div className="flex flex-col items-center gap-4 flex-1">
                <div className="flex items-center gap-3 text-amber-700 font-bold uppercase tracking-wide text-lg mb-1">
                   <PhilippinePeso size={32} />
                   <span>Total Price</span>
                </div>
                <div className="text-7xl font-bold text-blue-700 tracking-tight whitespace-nowrap">
                   ₱{totalPrice.toFixed(2)}
                </div>
             </div>

          </div>

          {/* Simple Info Text */}
          <div className="flex items-start gap-2 text-gray-500 text-lg max-w-lg text-center mt-2">
             <Info size={24} className="shrink-0 mt-1 text-blue-500" />
             <p>Verify the details above. When satisfied, <span className="font-semibold text-gray-800">close the door</span> and click the button below.</p>
          </div>
        </div>

        {/* Action Button */}
        <div style={{ padding: '24px', width: '100%', borderTop: '1px solid #f3f4f6', backgroundColor: 'white' }}>
          <button 
            onClick={handleLock} 
            disabled={currentWeight <= 0}
            className={`btn-full ${currentWeight > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >
            {currentWeight > 0 ? (
               <div className="flex items-center justify-center gap-2">
                  <Lock size={24} />
                  <span>Lock Locker & Pay</span>
               </div>
            ) : (
               <span>Waiting for items...</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // --- RENDER: STEP 3 - LOCKING ---
  if (step === 'weighing') {
    return (
      <div className="weighing-page" style={{ flexDirection: 'column', gap: '1.5rem' }}>
        <div className="status-circle" style={{ marginBottom: '0' }}>
           <Lock size={48} className="text-blue-600" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <h2 className="text-xl font-bold text-gray-800">Locking Locker...</h2>
          <div className="flex items-center justify-center gap-3 mt-4 text-gray-500 bg-gray-50 px-4 py-2 rounded-lg">
             <Loader2 className="animate-spin text-blue-500" size={20} />
             <span>Securing door & Finalizing weight</span>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER: STEP 4 - SUMMARY ---
  return (
    <div className="summary-page" style={{ flexDirection: 'column', height: '100%', padding: '0' }}>
      <div className="page-header" style={{ marginTop: '24px' }}>
        <h2 className="page-title">Drop Off Summary</h2>
        <p className="page-subtitle">Review your transaction</p>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div className="summary-card" style={{ width: '100%', maxWidth: '380px', borderRadius: '1rem', overflow: 'hidden' }}>
          
          <div className="bg-blue-50 p-4 border-b border-blue-100 text-center">
             <h3 className="text-blue-900 font-semibold">Locker {lockerId}</h3>
          </div>

          <div className="p-6 space-y-6">
             <div className="flex flex-col items-center gap-1">
                <span className="text-sm text-gray-500 uppercase tracking-wide">Final Weight</span>
                <span className="text-3xl font-bold text-gray-800">{currentWeight.toFixed(1)} <span className="text-lg text-gray-400 font-normal">kg</span></span>
             </div>
             
             <div className="h-px bg-gray-100 w-full"></div>

             <div className="flex flex-col items-center gap-1">
                <span className="text-sm text-gray-500 uppercase tracking-wide">Total Due</span>
                <span className="text-4xl font-bold text-blue-600">₱{totalPrice.toFixed(2)}</span>
             </div>
             
             <div className="text-center text-xs text-gray-400">
               Rate: ₱{pricePerKg.toFixed(2)} / kg
             </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px', width: '100%', borderTop: '1px solid #f3f4f6', backgroundColor: 'white' }}>
        <button 
          onClick={() => onComplete(totalPrice, currentWeight)} 
          className="btn-full bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-100"
        >
          Confirm & Pay
        </button>
      </div>
    </div>
  );
}