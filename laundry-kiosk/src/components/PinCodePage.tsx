import { useState } from 'react';
import { Lock, Delete, AlertCircle, Loader2 } from 'lucide-react';
import { db } from '../../firebaseConfig'; 
import { collection, query, where, getDocs } from 'firebase/firestore'; 

interface PinCodePageProps {
  lockerId: number;
  correctPin: string; 
  onVerified: () => void;
  onCancel: () => void;
}

export function PinCodePage({ lockerId, correctPin, onVerified, onCancel }: PinCodePageProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('Incorrect PIN');
  const [verifying, setVerifying] = useState(false);

  const handleNumberClick = async (num: string) => {
    // Prevent input if already 4 digits or currently verifying
    if (pin.length < 4 && !verifying) {
      const newPin = pin + num;
      setPin(newPin);
      setError(false);
      setErrorMsg('Incorrect PIN');

      // Auto-submit when 4 digits are reached
      if (newPin.length === 4) {
        setVerifying(true);
        try {
            // 1. Query DB for the transaction associated with this Locker + PIN + Active Status
            const q = query(
                collection(db, "transactions"),
                where("lockerId", "==", lockerId),
                where("pin", "==", newPin),
                where("status", "==", "paid_pending") 
            );

            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                // PIN not found or transaction completed
                handleError('Invalid PIN');
            } else {
                // 2. Transaction found, check laundry status
                const data = querySnapshot.docs[0].data();
                const laundryStatus = data.laundryStatus || 'dropped';

                if (laundryStatus === 'done') {
                    // Success!
                    onVerified();
                } else {
                    // Found, but not ready
                    let displayStatus = 'Pending';
                    if (laundryStatus === 'processing') displayStatus = 'Washing';
                    
                    handleError(`Laundry is ${displayStatus}. Not ready.`);
                }
            }
        } catch (err) {
            console.error("Verification error:", err);
            handleError('System Error');
        } finally {
            setVerifying(false);
        }
      }
    }
  };

  const handleError = (msg: string) => {
    setError(true);
    setErrorMsg(msg);
    // Clear pin after short delay
    setTimeout(() => {
      setPin('');
      setError(false);
    }, 2500);
  };

  const handleDelete = () => {
    if (!verifying) {
      setPin(pin.slice(0, -1));
      setError(false);
    }
  };

  const handleClear = () => {
    if (!verifying) {
      setPin('');
      setError(false);
    }
  };

  return (
    <div className="pin-page">
      <div className="pin-content">
        <div className="pin-info">
          <Lock size={64} className="pin-icon" />
          <h2 className="pin-title">Enter PIN Code</h2>
          <p className="pin-locker">Locker {lockerId}</p>
          {/* We keep the demo PIN display for convenience, though validation is now DB-based */}
          <p className="pin-demo">(Demo PIN: {correctPin})</p>
          
          <div className="pin-display">
            <div className="pin-dots">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`pin-dot ${pin.length > i ? 'filled' : ''} ${error ? 'error' : ''}`}
                >
                  {pin.length > i && '•'}
                </div>
              ))}
            </div>
            
            {verifying && (
                <div className="pin-status" style={{marginTop: '1rem', color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
                    <Loader2 className="animate-spin" size={18} /> Verifying...
                </div>
            )}

            {error && (
              <div className="pin-error" style={{marginTop: '1rem', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'}}>
                <AlertCircle size={18} />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          <div style={{ marginTop: '24px' }}>
            <button onClick={onCancel} className="btn-return">
              Return to Lockers
            </button>
          </div>
        </div>

        <div className="pin-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              onClick={() => handleNumberClick(num)}
              disabled={pin.length >= 4 || verifying}
              className="pin-key"
            >
              {num}
            </button>
          ))}
          
          <button onClick={handleClear} disabled={verifying} className="pin-key clear">
            Clear
          </button>
          
          <button
            onClick={() => handleNumberClick('0')}
            disabled={pin.length >= 4 || verifying}
            className="pin-key"
          >
            0
          </button>
          
          <button onClick={handleDelete} disabled={verifying} className="pin-key delete">
            <Delete size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}