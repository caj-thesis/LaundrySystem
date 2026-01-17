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

  // Use a Ref to keep the latest onComplete function stable across re-renders
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Math.max ensures we don't show negative numbers
  const remainingBalance = Math.max(0, price - cashInserted);
  const isPaymentComplete = cashInserted >= price;

  // 1. Initialize Hardware Polling
  useEffect(() => {
    const startPaymentSession = async () => {
      try {
        // Get Baseline Credit
        const res = await fetch('http://localhost:3000/api/status');
        if (!res.ok) throw new Error('Failed to connect');
        const data = await res.json();
        
        baselineCreditRef.current = typeof data.credit === 'number' ? data.credit : 0;
        setConnectionError(false);

        // Poll for changes
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

  // 2. AUTO-REDIRECT: Watch for payment completion
  useEffect(() => {
    if (isPaymentComplete) {
      // Timer waits 1.5s, then calls the STABLE ref function
      const timer = setTimeout(() => {
        onCompleteRef.current(); 
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isPaymentComplete]); // IMPORTANT: Do NOT include onComplete here

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

          {/* STATUS DISPLAY (No Button) */}
          <div style={{ 
            marginTop: '24px', 
            height: '80px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}>
            {isPaymentComplete ? (
              <div className="flex flex-col items-center text-green-600 animate-bounce">
                 <CheckCircle size={32} />
                 <span className="text-xl font-bold">Payment Complete!</span>
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