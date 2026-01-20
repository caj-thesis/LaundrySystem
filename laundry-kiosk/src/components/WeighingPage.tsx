import { useState, useEffect } from 'react';
import { Scale, PhilippinePeso, Loader2, ArrowLeft, Lock, DoorOpen, Info, Delete, X } from 'lucide-react';

interface WeighingPageProps {
  lockerId: number;
  currentWeight: number; 
  onComplete: (price: number, weight: number, customerPhone: string) => void;
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
const handleLock = async () => {
  setStep('weighing'); // Show the "Locking..." loading state
  
  try {
    // Call the new lock API
    await fetch('http://localhost:3000/api/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockerId }),
    });
    
    // The useEffect already handles moving from 'weighing' to 'summary' after 2.5s
  } catch (err) {
    console.error("Locking failed:", err);
    // Even if it fails, you might want to move to summary or show an error
    setStep('summary');
  }
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



  // --- STATE & HANDLERS FOR SMS ---
  const [customerPhone, setCustomerPhone] = useState('');

  // Validate: Must be exactly 11 digits and numeric
  const isValidPhone = customerPhone.length === 11 && /^\d+$/.test(customerPhone);

  const handleKeypadPress = (digit: string) => {
    if (customerPhone.length < 11) {
      setCustomerPhone(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    setCustomerPhone(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setCustomerPhone('');
  };

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
        <div className="page-header" style={{ marginTop: '16px', marginBottom: '8px' }}>
           <h2 className="page-title">Locker {lockerId}</h2>
           <p className="page-subtitle" style={{ fontSize: '16px' }}>Place your laundry inside.</p>
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
          padding: '0 24px',
          gap: '16px'
        }}>
          
          {/* Status Badge */}
          <div className="bg-white border border-green-200 text-green-700 px-4 py-1 rounded-full flex items-center gap-2 font-medium shadow-sm text-sm">
            <DoorOpen size={16} />
            <span>Door Unlocked & Scale Active</span>
          </div>

          {/* HIGHLIGHTED CARDS SECTION */}
          <div style={{ display: 'flex', width: '100%', maxWidth: '900px', gap: '24px', alignItems: 'stretch' }}>
             
             {/* Weight Card */}
             <div style={{ 
                 backgroundColor: '#2563eb', 
                 color: 'white',
                 borderRadius: '24px',
                 padding: '24px',
                 flex: 1,
                 display: 'flex',
                 flexDirection: 'column',
                 alignItems: 'center',
                 justifyContent: 'center',
                 boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
             }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.9 }}>
                   <Scale size={28} />
                   <span>Current Weight</span>
                </div>
                <div style={{ fontSize: '72px', fontWeight: '800', lineHeight: '1', whiteSpace: 'nowrap' }}>
                   {currentWeight.toFixed(1)} <span style={{ fontSize: '32px', fontWeight: '500' }}>kg</span>
                </div>
             </div>

             {/* Price Card */}
             <div style={{ 
                 backgroundColor: '#d97706', 
                 color: 'white',
                 borderRadius: '24px',
                 padding: '24px',
                 flex: 1,
                 display: 'flex',
                 flexDirection: 'column',
                 alignItems: 'center',
                 justifyContent: 'center',
                 boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
             }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.9 }}>
                   <PhilippinePeso size={28} />
                   <span>Total Price</span>
                </div>
                <div style={{ fontSize: '72px', fontWeight: '800', lineHeight: '1', whiteSpace: 'nowrap' }}>
                   ₱{totalPrice.toFixed(2)}
                </div>
             </div>

          </div>

          {/* Simple Info Text */}
          <div className="flex items-center gap-2 text-gray-400 text-xs">
             <Info size={14} />
             <p>Close door when finished.</p>
          </div>
        </div>

        {/* Action Button */}
        <div style={{ padding: '16px 24px', width: '100%', borderTop: '1px solid #f3f4f6', backgroundColor: 'white' }}>
          <button 
            onClick={handleLock} 
            disabled={currentWeight <= 0}
            className={`btn-full ${currentWeight > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            style={{ padding: '16px', fontSize: '20px' }}
          >
            {currentWeight > 0 ? (
               <div className="flex items-center justify-center gap-3">
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

  // --- RENDER: STEP 4 - SUMMARY (Receipt + Keypad) ---
  return (
    <div className="summary-page" style={{ 
      flexDirection: 'column', 
      height: '100%', 
      padding: '0', 
      backgroundColor: '#f3f4f6',
      overflow: 'hidden' 
    }}>
      
      {/* Header */}
      <div className="page-header" style={{ 
         padding: '12px 0 8px', 
         marginBottom: '0',
         textAlign: 'center',
         flexShrink: 0
      }}>
        <h2 className="text-xl font-bold text-gray-800">Drop Off Summary</h2>
        <p className="text-sm text-gray-500">Review transaction & enter contact details</p>
      </div>

      {/* Main Content - Split Layout */}
      <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'row', 
          alignItems: 'stretch',
          justifyContent: 'center', 
          gap: '24px', 
          padding: '8px 24px', 
          overflowY: 'auto' 
      }}>
        
        {/* LEFT CARD: Receipt */}
        <div style={{ 
            backgroundColor: 'white',
            flex: 1, 
            maxWidth: '500px', 
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            borderTop: '6px solid #2563eb', 
            display: 'flex',
            flexDirection: 'column',
            fontFamily: '"Courier New", Courier, monospace'
        }}>
           <div style={{ 
               padding: '16px 24px', 
               borderBottom: '2px dashed #e5e7eb',
               backgroundColor: '#f8fafc',
               display: 'flex', 
               justifyContent: 'space-between', 
               alignItems: 'center' 
           }}>
              <div>
                 <span style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 'bold', letterSpacing: '1px' }}>Locker Unit</span>
                 <span style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>#{lockerId}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 'bold', letterSpacing: '1px' }}>Date</span>
                  <span style={{ fontSize: '16px', fontWeight: '600', color: '#334155' }}>{new Date().toLocaleDateString()}</span>
              </div>
           </div>

           <div style={{ padding: '20px 24px', flex: 1 }}> 
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
                 <div>
                    <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e293b' }}>Laundry Load</span>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Rate: ₱{pricePerKg.toFixed(2)} / kg</div>
                 </div>
                 <span style={{ fontSize: '20px', fontWeight: '600', color: '#1e293b' }}>{currentWeight.toFixed(1)} kg</span>
              </div>

              <div style={{ width: '100%', height: '2px', borderTop: '2px dashed #cbd5e1', margin: '16px 0' }}></div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <span style={{ fontSize: '20px', fontWeight: '800', textTransform: 'uppercase', color: '#0f172a' }}>Total Due</span>
                 <span style={{ fontSize: '48px', fontWeight: '800', color: '#2563eb', lineHeight: '1' }}>₱{totalPrice.toFixed(2)}</span>
              </div>
           </div>
        </div>

        {/* RIGHT CARD: SMS Input with Keypad */}
        <div style={{ 
            backgroundColor: 'white',
            flex: 1, 
            maxWidth: '500px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            borderTop: '6px solid #16a34a',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 24px' // Slightly tighter padding to fit keypad
        }}>
            <h3 className="text-lg font-bold text-gray-800 mb-2">SMS Notification</h3>
            
            {/* Display Screen */}
            <div className="relative mb-4">
              <input
                type="text"
                readOnly
                value={customerPhone}
                placeholder="09XXXXXXXXX"
                className="w-full text-2xl font-bold text-center p-3 border-2 rounded-lg bg-gray-50 text-gray-800 focus:outline-none"
                style={{
                  letterSpacing: '3px',
                  borderColor: isValidPhone ? '#16a34a' : '#e5e7eb'
                }}
              />
              <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)' }}>
                {isValidPhone && <span style={{ color: '#16a34a', fontSize: '24px' }}>✔</span>}
              </div>
            </div>

            {/* Keypad Grid */}
            <div style={{ 
               flex: 1, 
               display: 'grid', 
               gridTemplateColumns: 'repeat(3, 1fr)', 
               gap: '12px',
               marginBottom: '8px' 
            }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num.toString())}
                  className="bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 rounded-lg text-xl font-bold shadow-sm transition-colors"
                  style={{ height: '100%' }}
                >
                  {num}
                </button>
              ))}
              
              {/* Bottom Row */}
              <button 
                onClick={handleClear}
                className="bg-red-50 hover:bg-red-100 text-red-600 rounded-lg flex items-center justify-center font-bold"
              >
                <X size={24} />
              </button>
              
              <button 
                onClick={() => handleKeypadPress('0')}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xl font-bold"
              >
                0
              </button>
              
              <button 
                onClick={handleBackspace}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg flex items-center justify-center"
              >
                <Delete size={24} />
              </button>
            </div>
            
            <div className="h-6 text-center">
               {!isValidPhone && customerPhone.length > 0 && (
                 <span className="text-red-500 text-xs font-medium">11 Digits Required</span>
               )}
            </div>
        </div>

      </div>

      {/* Footer Action Button */}
      <div style={{ 
          padding: '16px 24px', 
          width: '100%', 
          borderTop: '1px solid #e5e7eb', 
          backgroundColor: 'white',
          flexShrink: 0 
      }}>
        <button 
          onClick={() => onComplete(totalPrice, currentWeight, customerPhone)} 
          disabled={!isValidPhone}
          className={`btn-full shadow-lg text-white ${
            isValidPhone 
              ? 'bg-green-600 hover:bg-green-700 shadow-green-100' 
              : 'bg-gray-300 cursor-not-allowed shadow-none'
          }`}
          style={{ padding: '16px', fontSize: '20px', fontWeight: 'bold', transition: 'all 0.2s' }}
        >
          {isValidPhone ? 'CONFIRM & DROP OFF' : 'ENTER PHONE NUMBER'}
        </button>
      </div>
    </div>
  );
}