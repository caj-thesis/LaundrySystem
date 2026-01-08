import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, WifiOff } from 'lucide-react';

interface PaymentPageProps {
  lockerId: number;
  price: number;  
  weight: number; 
  onComplete: () => void;
  onCancel: () => void;
}

export function PaymentPage({ lockerId, price, weight, onComplete, onCancel }: PaymentPageProps) {
  const [cashInserted, setCashInserted] = useState(0);
  const [isHardwareConnected, setIsHardwareConnected] = useState(true);
  const pollInterval = useRef<number | null>(null);
  
  const remainingBalance = price - cashInserted;
  const isPaymentComplete = cashInserted >= price;

  useEffect(() => {
    let isMounted = true;

    const startPaymentSession = async () => {
      try {
        // 1. Get Baseline Credit
        const res = await fetch('http://localhost:3000/api/status').catch(() => null);
        
        if (!res || !res.ok) {
           console.error("Backend unreachable for payment session init");
           if (isMounted) setIsHardwareConnected(false);
           return;
        }

        const data = await res.json();
        // Ensure baseline is a number, default to 0 if missing
        const baselineCredit = typeof data.credit === 'number' ? data.credit : 0;
        console.log(`Payment Session Started. Baseline Credit: ₱${baselineCredit}`);

        if (isMounted) setIsHardwareConnected(true);

        // 2. Start Polling
        pollInterval.current = window.setInterval(async () => {
          try {
            const pollRes = await fetch('http://localhost:3000/api/status');
            if (!pollRes.ok) throw new Error("Status fetch failed");
            
            const pollData = await pollRes.json();
            
            const currentTotal = typeof pollData.credit === 'number' ? pollData.credit : 0;
            const sessionCredit = currentTotal - baselineCredit;
            
            // Only update if positive (handling hardware resets gracefully)
            if (isMounted && sessionCredit >= 0) {
              setCashInserted(sessionCredit);
              setIsHardwareConnected(true);
            }
          } catch (e) {
            console.error("Polling error", e);
            if (isMounted) setIsHardwareConnected(false);
          }
        }, 500);

      } catch (err) {
        console.error("Payment system error", err);
        if (isMounted) setIsHardwareConnected(false);
      }
    };

    startPaymentSession();

    return () => {
      isMounted = false;
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, []);

  const handleConfirm = () => {
    if (isPaymentComplete) {
      onComplete();
    }
  };

  const handleCancel = () => {
    setCashInserted(0);
    onCancel();
  };

  return (
    <div className="payment-page">
      <div className="payment-header-section">
        <div className="payment-header">
          <h2 className="payment-title">Cash Payment</h2>
          <p className="payment-locker">Locker {lockerId}</p>
        </div>
        <button onClick={handleCancel} className="btn-return">
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>
      </div>

      {!isHardwareConnected && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 flex items-center gap-2" role="alert">
          <WifiOff size={18} />
          <span>Hardware disconnected. Please check coin acceptor.</span>
        </div>
      )}

      <div className="payment-content">
        <div className="payment-left">
          <div className="payment-amount-card">
            <div className="payment-amount-label">Total Amount</div>
            <div className="payment-amount-value">₱{price.toFixed(2)}</div>
            <div className="payment-amount-detail">
              Weight: {weight.toFixed(1)} kg @ ₱25/kg
            </div>
          </div>
        </div>

        <div className="payment-right">
          <div className="cash-payment-container">
            <div className="cash-inserted-card">
              <div className="cash-inserted-label">Cash Inserted (Hardware)</div>
              <div className="cash-inserted-amount">₱{cashInserted.toFixed(2)}</div>
              <div className="cash-balance">
                <span className="cash-balance-label">
                  {isPaymentComplete ? 'Change:' : 'Remaining:'}
                </span>
                <span className={`cash-balance-value ${isPaymentComplete ? 'complete' : ''}`}>
                  ₱{Math.abs(remainingBalance).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="payment-actions">
              <button onClick={handleCancel} className="btn-cancel">
                Cancel
              </button>
              <button 
                onClick={handleConfirm} 
                className="btn-confirm"
                disabled={!isPaymentComplete}
              >
                {isPaymentComplete ? 'Complete Payment' : 'Insert Coins in Slot'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}