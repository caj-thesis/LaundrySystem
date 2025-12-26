import { useState } from 'react';
import { Coins, ArrowLeft } from 'lucide-react';

interface PaymentPageProps {
  lockerId: number;
  onComplete: () => void;
  onCancel: () => void;
}

const lockerData: Record<number, { weight: number; price: number }> = {
  6: { weight: 8.5, price: 212.5 },
  8: { weight: 6.0, price: 150.0 },
  10: { weight: 12.5, price: 312.5 },
  12: { weight: 4.5, price: 112.5 },
};

const coinDenominations = [1, 5, 10, 20];

export function PaymentPage({ lockerId, onComplete, onCancel }: PaymentPageProps) {
  const [cashInserted, setCashInserted] = useState(0);
  
  const locker = lockerData[lockerId];
  const remainingBalance = locker.price - cashInserted;
  const isPaymentComplete = cashInserted >= locker.price;

  const handleCoinInsert = (amount: number) => {
    setCashInserted(prev => prev + amount);
  };

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

      <div className="payment-content">
        <div className="payment-left">
          <div className="payment-amount-card">
            <div className="payment-amount-label">Total Amount</div>
            <div className="payment-amount-value">₱{locker.price.toFixed(2)}</div>
            <div className="payment-amount-detail">
              Weight: {locker.weight} kg @ ₱25/kg
            </div>
          </div>
        </div>

        <div className="payment-right">
          <div className="cash-payment-container">
            <div className="cash-inserted-card">
              <div className="cash-inserted-label">Cash Inserted</div>
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
                {isPaymentComplete ? 'Complete Payment' : 'Insert More Coins'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}