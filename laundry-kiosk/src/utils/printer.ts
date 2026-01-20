import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle } from 'lucide-react';

interface PaymentPageProps {
  lockerId: number;
  price: number;   
  weight: number; 
  onComplete: () => void;
  onCancel: () => void;
}

export function PaymentPage({ lockerId, price, weight, onComplete, onCancel }: PaymentPageProps) {
  const [cashInserted, setCashInserted] = useState(0);
  const [connectionError, setConnectionError] = useState(false);
  const pollInterval = useRef<number | null>(null);
  const baselineCreditRef = useRef<number>(0);
  
  // Ref to prevent multiple print triggers during the redirect delay
  const hasPrintedRef = useRef(false);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const remainingBalance = Math.max(0, price - cashInserted);
  const isPaymentComplete = cashInserted >= price;

  // 1. Initialize Hardware Polling (Coinslot)
  useEffect(() => {
    const startPaymentSession = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/status');
        if (!res.ok) throw new Error('Failed to connect');
        const data = await res.json();
        
        baselineCreditRef.current = typeof data.credit === 'number' ? data.credit : 0;
        setConnectionError(false);

        pollInterval.current = window.setInterval(async () => {
          try {
            const pollRes = await fetch('http://localhost:3000/api/status');
            const pollData = await pollRes.json();
            
            const currentTotal = typeof pollData.credit === 'number' ? pollData.credit : 0;
            const sessionCredit = currentTotal - baselineCreditRef.current;

            if (sessionCredit >= 0) setCashInserted(sessionCredit);
            setConnectionError(false);
          } catch (e) {
            setConnectionError(true);
          }
        }, 500);

      } catch (err) {
        console.error("Payment init error", err);
        setConnectionError(true);
      }
    };

    startPaymentSession();
    return () => { if (pollInterval.current) clearInterval(pollInterval.current); };
  }, []);

  // 2. AUTO-PRINT & AUTO-REDIRECT
  useEffect(() => {
    if (isPaymentComplete && !hasPrintedRef.current) {
      // Mark as printed immediately to prevent double receipts
      hasPrintedRef.current = true;

      // Send print command to your Raspberry Pi backend
      fetch('http://localhost:3000/api/print-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lockerUnit: lockerId,
          weight: weight,
          totalDue: price,
          date: new Date().toLocaleDateString('en-GB')
        })
      }).catch(err => console.error("Printing failed:", err));

      // Timer waits 1.5s, then redirects to success screen
      const timer = setTimeout(() => {
        onCompleteRef.current(); 
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [isPaymentComplete, lockerId, price, weight]);

  return (
    <div className="payment-page">
      <div className="payment-header-section">
        <h2 className="payment-title">Cash Payment - Locker {lockerId}</h2>
        <button onClick={onCancel} className="btn-return">
          <ArrowLeft size={20} style={{ marginRight: '8px' }} /> Return
        </button>
      </div>

      <div className="payment-content">
        {connectionError && <div style={{color: 'red', marginBottom: '10px'}}>⚠️ Hardware Disconnected</div>}
        
        <div className="payment-left">
          <div className="payment-amount-card">
             <div className="payment-amount-label">Total Due</div>
             <div className="payment-amount-value">₱{price.toFixed(2)}</div>
          </div>
        </div>

        <div className="payment-right">
          <div className="cash-inserted-card">
            <div className="cash-inserted-label">Cash Inserted</div>
            <div className="cash-inserted-amount">₱{cashInserted.toFixed(2)}</div>
            <div className="cash-balance">
              <span>Remaining:</span>
              <span className={isPaymentComplete ? 'complete' : ''}>
                ₱{remainingBalance.toFixed(2)}
              </span>
            </div>
          </div>

          <div style={{ 
            marginTop: '24px', 
            height: '80px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}>
            {isPaymentComplete ? (
              <div className="flex flex-col items-center text-green-600 animate-bounce text-center">
                 <CheckCircle size={32} />
                 <span className="text-xl font-bold">Payment Complete!</span>
                 <p className="text-sm text-gray-500">Printing receipt...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center text-gray-400 animate-pulse">
                 <span className="text-lg font-medium">Please insert coins...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}