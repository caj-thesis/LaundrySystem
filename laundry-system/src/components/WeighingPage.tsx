import { useState, useEffect } from 'react';
import { Scale, PhilippinePeso, Loader2, ArrowLeft, Lock, DoorOpen, Info, Delete, AlertTriangle } from 'lucide-react';
import { getChargeableWeight, normalizeWeight } from '../utils/weight';

interface WeighingPageProps {
  lockerId: number;
  currentWeight: number; 
  pricePerKg: number; 
  minimumPrice: number;
  doorStatus: string;
  onComplete: (price: number, weight: number, customerPhone: string) => void;
  onBack: () => void;
}

type WarningTone = 'warning' | 'danger';

interface WarningDialogState {
  title: string;
  message: string;
  tone: WarningTone;
}

const MAX_WEIGHT = 20.0;

interface WeighingWarningDialogProps {
  warning: WarningDialogState | null;
  onClose: () => void;
}

function WeighingWarningDialog({ warning, onClose }: WeighingWarningDialogProps) {
  if (!warning) {
    return null;
  }

  const accentColor = warning.tone === 'danger' ? '#dc2626' : '#d97706';
  const accentBackground = warning.tone === 'danger' ? '#fef2f2' : '#fff7ed';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(15, 23, 42, 0.58)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="weighing-warning-title"
        aria-describedby="weighing-warning-message"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: '#ffffff',
          borderRadius: '28px',
          padding: '28px 24px 24px',
          boxShadow: '0 32px 64px rgba(15, 23, 42, 0.24)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '999px',
            margin: '0 auto 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: accentBackground,
            color: accentColor,
          }}
        >
          <AlertTriangle size={36} />
        </div>

        <h3
          id="weighing-warning-title"
          style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}
        >
          {warning.title}
        </h3>
        <p
          id="weighing-warning-message"
          style={{ fontSize: '17px', lineHeight: 1.5, color: '#475569', marginBottom: '22px' }}
        >
          {warning.message}
        </p>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            border: 'none',
            borderRadius: '18px',
            padding: '16px',
            backgroundColor: accentColor,
            color: '#ffffff',
            fontSize: '18px',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}

export function WeighingPage({ lockerId, currentWeight, pricePerKg, minimumPrice, doorStatus, onComplete, onBack }: WeighingPageProps) {
  const [step, setStep] = useState<'opening' | 'unlocked' | 'weighing' | 'summary'>('opening');
  const [isReturning, setIsReturning] = useState(false);
  const [warningDialog, setWarningDialog] = useState<WarningDialogState | null>(null);
  const signedCurrentWeight = normalizeWeight(currentWeight);

  // State to freeze the weight when the user locks the locker
  const [frozenWeight, setFrozenWeight] = useState<number | null>(null);

  // Determine which weight to use: the frozen one (if locked) or the live one
  const actualWeight = frozenWeight !== null ? frozenWeight : signedCurrentWeight;
  const roundedWeight = normalizeWeight(actualWeight);
  const formattedWeight = roundedWeight.toFixed(2);
  const chargeableWeight = getChargeableWeight(actualWeight);
  const calculatedPrice = chargeableWeight * pricePerKg;
  const totalPrice = chargeableWeight > 0 ? Math.max(minimumPrice, calculatedPrice) : 0;
  const isNegativeReading = roundedWeight < 0;
  const isOverweight = chargeableWeight > MAX_WEIGHT;
  const isLockButtonDisabled = chargeableWeight <= 0;

  const showWarning = (title: string, message: string, tone: WarningTone = 'warning') => {
    setWarningDialog({ title, message, tone });
  };

  // --- STATE & HANDLERS FOR SMS ---
  // UPDATED: Default to '09'
  const [customerPhone, setCustomerPhone] = useState('09');

  // UPDATED: Valid if it's just '09' (skipped) OR exactly 11 digits
  const isSkipped = customerPhone === '09' || customerPhone.length === 0;
  const isComplete = customerPhone.length === 11 && /^\d+$/.test(customerPhone);
  const isValidInput = isSkipped || isComplete;

  useEffect(() => {
    setStep('opening');
    setIsReturning(false);
    setWarningDialog(null);
    setFrozenWeight(null);
    setCustomerPhone('09');
  }, [lockerId]);

  // 1. Auto-Unlock on Mount
  useEffect(() => {
    const unlockSequence = async () => {
      try {
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
    // --- NEW CHECK: Ensure door is closed ---
    if (doorStatus === 'OPEN') {
      showWarning('Door Still Open', 'Please close the locker door before proceeding to payment.');
      return;
    }

    if (isOverweight) {
      showWarning('Load Too Heavy', 'Weight limit exceeded. Please reduce the load to under 20 kg.', 'danger');
      return;
    }

    setFrozenWeight(roundedWeight);
    setStep('weighing'); 
    
    try {
      await fetch('http://localhost:3000/api/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId }),
      });
    } catch (err) {
      console.error("Locking failed:", err);
      setStep('summary');
    }
  };
  
   // 3. Simulate Locking & Final Weighing
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (step === 'weighing') {
      timer = setTimeout(() => {
        setStep('summary');
      }, 2500);
    }

    return () => clearTimeout(timer);
  }, [step]);

  const handleKeypadPress = (digit: string) => {
    if (customerPhone.length < 11) {
      setCustomerPhone(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    // UPDATED: Prevent deleting the '09' prefix
    if (customerPhone.length > 2) {
      setCustomerPhone(prev => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    // UPDATED: Reset to '09' instead of empty string
    setCustomerPhone('09');
  };

  const handleReturnToLaundryType = async () => {
    setIsReturning(true);
    try {
      await fetch('http://localhost:3000/api/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId }),
      });
    } catch (err) {
      console.error('Failed to lock locker on return:', err);
    } finally {
      setIsReturning(false);
      onBack();
    }
  };

  const handleReturnToWeighing = async () => {
    setIsReturning(true);
    try {
      await fetch('http://localhost:3000/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId }),
      });
    } catch (err) {
      console.error('Failed to unlock locker on summary return:', err);
    } finally {
      setFrozenWeight(null);
      setStep('unlocked');
      setIsReturning(false);
    }
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
      <>
      <div className="weighing-page" style={{ flexDirection: 'column', justifyContent: 'flex-start', padding: '0', height: '100%', position: 'relative', overflowY: 'auto', overflowX: 'hidden' }}>
        
        {/* Header Section */}
        <div className="page-header" style={{ marginTop: '16px', marginBottom: '8px' }}>
           <h2 className="page-title">Locker {lockerId}</h2>
           <p className="page-subtitle" style={{ fontSize: '16px' }}>Place your laundry inside.</p>
        </div>

        {/* Return Button */}
        <button onClick={handleReturnToLaundryType} className="btn-return-top" disabled={isReturning}>
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          {isReturning ? 'Returning...' : 'Return'}
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
          <div className={`border px-4 py-1 rounded-full flex items-center gap-2 font-medium shadow-sm text-sm ${doorStatus === 'OPEN' ? 'bg-white border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
            <DoorOpen size={16} />
            <span>{doorStatus === 'OPEN' ? 'Door Open' : 'Door Closed'} & Scale Active</span>
          </div>

          {/* Cards */}
          <div style={{ display: 'flex', width: '100%', maxWidth: '900px', gap: '24px', alignItems: 'stretch' }}>
             
             {/* Weight Card - UPDATED WITH WARNING */}
             <div style={{ 
                 backgroundColor: isOverweight ? '#ef4444' : (isNegativeReading ? '#b45309' : '#2563eb'),
                 color: 'white',
                 borderRadius: '24px',
                 padding: '24px',
                 flex: 1,
                 display: 'flex',
                 flexDirection: 'column',
                 alignItems: 'center',
                 justifyContent: 'center',
                 boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                 transition: 'background-color 0.3s ease'
             }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px', opacity: 0.9 }}>
                   <Scale size={28} />
                   <span>Current Weight</span>
                </div>
                <div style={{ fontSize: '72px', fontWeight: '800', lineHeight: '1', whiteSpace: 'nowrap' }}>
                   {formattedWeight} <span style={{ fontSize: '32px', fontWeight: '500' }}>kg</span>
                </div>
                
                {/* Warning Message */}
                {isOverweight && (
                  <div className="flex items-center gap-2 mt-2 bg-white/20 px-3 py-1 rounded-full animate-pulse">
                    <AlertTriangle size={18} className="text-white" />
                    <span className="text-sm font-bold">Max 20kg Exceeded!</span>
                  </div>
                )}
                {!isOverweight && isNegativeReading && (
                  <div className="flex items-center gap-2 mt-2 bg-white/20 px-3 py-1 rounded-full">
                    <AlertTriangle size={18} className="text-white" />
                    <span className="text-sm font-bold">Negative reading shown as-is</span>
                  </div>
                )}
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
                
                {/* --- NEW: Minimum Price UI Indicator --- */}
                {chargeableWeight > 0 && calculatedPrice < minimumPrice && (
                   <div style={{ marginTop: '8px', fontSize: '14px', opacity: 0.9, fontWeight: '500', backgroundColor: 'rgba(255,255,255,0.2)', padding: '4px 12px', borderRadius: '12px' }}>
                      (Minimum ₱{minimumPrice} applied)
                   </div>
                )}
             </div>

          </div>

          <div className="flex items-center gap-2 text-gray-400 text-xs">
             <Info size={14} />
             <span>{isNegativeReading ? 'Negative readings are visible, but billing stays at 0.00 until the scale goes positive.' : 'Close door when finished. Maximum load is 20kg.'}</span>
          </div>
        </div>

        {/* Action Button - UPDATED FOR OVERWEIGHT STATE */}
        <div style={{ padding: '16px 24px', width: '100%', borderTop: '1px solid #f3f4f6', backgroundColor: 'white' }}>
          <button 
            onClick={handleLock} 
            disabled={isLockButtonDisabled}
            className={`btn-full ${
              isOverweight 
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : chargeableWeight > 0 
                  ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            style={{ padding: '16px', fontSize: '20px' }}
          >
            {isOverweight ? (
               <div className="flex items-center justify-center gap-3">
                  <AlertTriangle size={24} />
                  <span>Limit Exceeded - Reduce Load</span>
               </div>
            ) : chargeableWeight > 0 ? (
               <div className="flex items-center justify-center gap-3">
                  <Lock size={24} />
                  <span>Lock Locker & Pay</span>
               </div>
            ) : (
               <span>{isNegativeReading ? 'Scale below zero - recheck load' : 'Waiting for items...'}</span>
            )}
          </button>
        </div>
      </div>
      <WeighingWarningDialog warning={warningDialog} onClose={() => setWarningDialog(null)} />
      </>
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
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      
      {/* Header */}
      <div className="page-header" style={{ 
          padding: '12px 0 8px', 
          marginBottom: '0',
          textAlign: 'center',
          flexShrink: 0
      }}>
        <button
          onClick={handleReturnToWeighing}
          className="btn-return-top"
          disabled={isReturning}
        >
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          {isReturning ? 'Returning...' : 'Return'}
        </button>
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
                     
                     {/* --- UPDATED: Rate with Minimum Price Indicator --- */}
                     <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Rate: ₱{pricePerKg.toFixed(2)} / kg</span>
                        {chargeableWeight > 0 && calculatedPrice < minimumPrice && (
                           <span style={{ color: '#d97706', fontWeight: 'bold', backgroundColor: '#fef3c7', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>
                             MIN ₱{minimumPrice}
                           </span>
                        )}
                     </div>
                  </div>
                  <span style={{ fontSize: '20px', fontWeight: '600', color: '#1e293b' }}>{formattedWeight} kg</span>
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
            maxWidth: '380px', 
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            borderTop: '6px solid #16a34a',
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 16px', // Compact padding
            height: '100%',
            overflow: 'hidden'
        }}>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold text-gray-800">SMS Notification</h3>
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Add a phone number for optional SMS updates.</span>
            </div>
            
            {/* Display Screen - More Compact */}
            <div className="relative mb-2 w-full">
              <input
                type="text"
                readOnly
                value={customerPhone}
                placeholder="Skip if none"
                className="w-full text-lg font-bold text-center p-1.5 border-2 rounded-md bg-gray-50 text-gray-800 focus:outline-none"
                style={{
                  letterSpacing: '1px',
                  borderColor: isComplete ? '#16a34a' : (isSkipped ? '#e5e7eb' : '#ef4444')
                }}
              />
            </div>

            {/* Keypad Grid - Flex-grow to fill space without overflowing */}
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)', 
                gap: '6px', // Tight gap
                flex: 1,           
                alignContent: 'center'
            }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num.toString())}
                  className="bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 rounded-md text-base font-bold shadow-sm"
                  style={{ height: '40px' }} // Small fixed height to prevent overlap
                >
                  {num}
                </button>
              ))}
              
              <button 
                onClick={handleClear}
                className="bg-red-50 hover:bg-red-100 text-red-600 rounded-md flex items-center justify-center font-bold text-[10px]"
                style={{ height: '40px' }}
              >
                CLEAR
              </button>
              
              <button 
                onClick={() => handleKeypadPress('0')}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-base font-bold"
                style={{ height: '40px' }}
              >
                0
              </button>
              
              <button 
                onClick={handleBackspace}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md flex items-center justify-center"
                style={{ height: '40px' }}
              >
                <Delete size={18} />
              </button>
            </div>
            
            {/* Error Message - Small text */}
            <div className="h-4 text-center mt-1">
              {!isValidInput && (
                <span className="text-red-500 text-[10px] leading-none">11 digits or clear to skip</span>
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
          onClick={() => onComplete(totalPrice, roundedWeight, customerPhone)} 
          disabled={!isValidInput}
          className={`btn-full shadow-lg text-white ${
            isValidInput 
              ? (isComplete ? 'bg-green-600 hover:bg-green-700 shadow-green-100' : 'bg-gray-600 hover:bg-gray-700') 
              : 'bg-gray-300 cursor-not-allowed shadow-none'
          }`}
          style={{ padding: '16px', fontSize: '20px', fontWeight: 'bold', transition: 'all 0.2s' }}
        >
          {isValidInput 
            ? (isComplete ? 'CONFIRM & DROP OFF' : 'CONFIRM (NO SMS)') 
            : 'ENTER PHONE OR CLEAR'
          }
        </button>
      </div>
    </div>
  );
}
