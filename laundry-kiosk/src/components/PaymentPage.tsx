import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, WifiOff, Coins } from 'lucide-react';

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

  const remainingBalance = price - cashInserted;
  const isPaymentComplete = cashInserted >= price;

  useEffect(() => {
    const startPaymentSession = async () => {
      try {
        // 1. Get Baseline Credit (credit currently on device)
        const res = await fetch('http://localhost:3000/api/status');
        if (!res.ok) throw new Error('Failed to connect');
        const data = await res.json();
        
        baselineCreditRef.current = typeof data.credit === 'number' ? data.credit : 0;
        setConnectionError(false);

        // 2. Start Polling for new credit
        pollInterval.current = window.setInterval(async () => {
          try {
            const pollRes = await fetch('http://localhost:3000/api/status');
            const pollData = await pollRes.json();
            
            const currentTotal = typeof pollData.credit === 'number' ? pollData.credit : 0;
            // Cash Inserted = Current Total - Baseline
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

  const handleConfirm = () => {
    if (isPaymentComplete) onComplete();
  };

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
              <span>{isPaymentComplete ? 'Change:' : 'Remaining:'}</span>
              <span className={isPaymentComplete ? 'complete' : ''}>
                ₱{Math.abs(remainingBalance).toFixed(2)}
              </span>
            </div>
          </div>

          <button 
            onClick={handleConfirm} 
            className="btn-confirm"
            disabled={!isPaymentComplete}
            style={{ opacity: isPaymentComplete ? 1 : 0.5 }}
          >
            {isPaymentComplete ? 'Complete Payment' : 'Insert Coins'}
          </button>
        </div>
      </div>
    </div>
  );
}