import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle } from 'lucide-react';

interface PaymentPageProps {
  lockerId: number;
  transactionId: string;
  price: number;
  weight: number;
  onComplete: () => void;
  onCancel: () => void;
}

interface SavedPaymentSession {
  baselineCredit: number;
  cashInserted: number;
}

const PAYMENT_SESSION_KEY_PREFIX = 'payment-session:';

function getPaymentSessionKey(transactionId: string) {
  return `${PAYMENT_SESSION_KEY_PREFIX}${transactionId}`;
}

function loadSavedPaymentSession(transactionId: string): SavedPaymentSession | null {
  try {
    const raw = window.localStorage.getItem(getPaymentSessionKey(transactionId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const baselineCredit = Number(parsed?.baselineCredit);
    const cashInserted = Number(parsed?.cashInserted);

    if (!Number.isFinite(baselineCredit) || !Number.isFinite(cashInserted)) {
      return null;
    }

    return {
      baselineCredit: Math.max(0, baselineCredit),
      cashInserted: Math.max(0, cashInserted),
    };
  } catch {
    return null;
  }
}

function savePaymentSession(transactionId: string, session: SavedPaymentSession) {
  try {
    window.localStorage.setItem(getPaymentSessionKey(transactionId), JSON.stringify(session));
  } catch {
    // Ignore storage failures and keep the payment flow running.
  }
}

function clearPaymentSession(transactionId: string) {
  try {
    window.localStorage.removeItem(getPaymentSessionKey(transactionId));
  } catch {
    // Ignore storage failures and keep the payment flow running.
  }
}

export function PaymentPage({ lockerId, transactionId, price, onComplete, onCancel }: PaymentPageProps) {
  const [cashInserted, setCashInserted] = useState(0);
  const [connectionError, setConnectionError] = useState(false);
  const pollInterval = useRef<number | null>(null);
  const baselineCreditRef = useRef<number>(0);
  const lastSavedCashInsertedRef = useRef<number>(0);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const remainingBalance = Math.max(0, price - cashInserted);
  const isPaymentComplete = cashInserted >= price;

  useEffect(() => {
    const startPaymentSession = async () => {
      try {
        const savedSession = loadSavedPaymentSession(transactionId);
        const res = await fetch('http://localhost:3000/api/status');
        if (!res.ok) throw new Error('Failed to connect');
        const data = await res.json();

        const currentTotal = typeof data.credit === 'number' ? data.credit : 0;
        baselineCreditRef.current = savedSession?.baselineCredit ?? currentTotal;
        const restoredCashInserted = Math.max(0, savedSession?.cashInserted ?? 0);
        lastSavedCashInsertedRef.current = restoredCashInserted;
        setCashInserted(restoredCashInserted);
        savePaymentSession(transactionId, {
          baselineCredit: baselineCreditRef.current,
          cashInserted: restoredCashInserted,
        });
        setConnectionError(false);

        pollInterval.current = window.setInterval(async () => {
          try {
            const pollRes = await fetch('http://localhost:3000/api/status');
            const pollData = await pollRes.json();

            const currentTotal = typeof pollData.credit === 'number' ? pollData.credit : 0;
            const sessionCredit = currentTotal - baselineCreditRef.current;
            const nextCashInserted =
              sessionCredit >= 0
                ? Math.max(lastSavedCashInsertedRef.current, sessionCredit)
                : lastSavedCashInsertedRef.current;

            lastSavedCashInsertedRef.current = nextCashInserted;
            setCashInserted(nextCashInserted);
            savePaymentSession(transactionId, {
              baselineCredit: baselineCreditRef.current,
              cashInserted: nextCashInserted,
            });
            setConnectionError(false);
          } catch (e) {
            setConnectionError(true);
          }
        }, 500);
      } catch (err) {
        console.error('Payment init error', err);
        setConnectionError(true);
      }
    };

    startPaymentSession();
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [transactionId]);

  useEffect(() => {
    if (isPaymentComplete) {
      const timer = setTimeout(() => {
        clearPaymentSession(transactionId);
        onCompleteRef.current();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isPaymentComplete, transactionId]);

  return (
    <div
      className="payment-page"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        backgroundColor: '#f9fafb',
        position: 'relative',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div className="available-lockers-container" style={{ marginTop: '12px', flexShrink: 0 }}>
        <div className="instructions-header">
          <h2>Coin Payment - Locker {lockerId}</h2>
          <button onClick={onCancel} className="btn-return-absolute" style={{ zIndex: 10 }}>
            <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
            Return
          </button>
        </div>
      </div>

      <div className="payment-content" style={{ minHeight: 0 }}>
        {connectionError && <div style={{ color: 'red', marginBottom: '10px' }}>Hardware Disconnected</div>}

        <div className="payment-left">
          <div className="payment-amount-card">
            <div className="payment-amount-label">Total Due</div>
            <div className="payment-amount-value">₱{price.toFixed(2)}</div>
          </div>
        </div>

        <div className="payment-right">
          <div className="cash-inserted-card">
            <div className="cash-inserted-label">Coin Inserted</div>
            <div className="cash-inserted-amount">₱{cashInserted.toFixed(2)}</div>
            <div className="cash-balance">
              <span>Remaining:</span>
              <span className={isPaymentComplete ? 'complete' : ''}>
                ₱{remainingBalance.toFixed(2)}
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: '24px',
              height: '80px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
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
