import { useState } from 'react';
import { Lock, Delete, AlertCircle } from 'lucide-react';

interface PinCodePageProps {
  lockerId: number;
  onVerified: () => void;
  onCancel: () => void;
}

const lockerPins: Record<number, string> = {
  6: '1234',
  8: '5678',
  10: '9012',
  12: '3456',
};

export function PinCodePage({ lockerId, onVerified, onCancel }: PinCodePageProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleNumberClick = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      setError(false);

      if (newPin.length === 4) {
        setTimeout(() => {
          if (newPin === lockerPins[lockerId]) {
            onVerified();
          } else {
            setError(true);
            setTimeout(() => {
              setPin('');
              setError(false);
            }, 1500);
          }
        }, 300);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError(false);
  };

  const handleClear = () => {
    setPin('');
    setError(false);
  };

  return (
    <div className="pin-page">
      <div className="pin-content">
        <div className="pin-info">
          <Lock size={64} className="pin-icon" />
          <h2 className="pin-title">Enter PIN Code</h2>
          <p className="pin-locker">Locker {lockerId}</p>
          <p className="pin-demo">(Demo PIN: {lockerPins[lockerId]})</p>
          
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
            
            {error && (
              <div className="pin-error">
                <AlertCircle size={18} />
                <span>Incorrect PIN</span>
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
              disabled={pin.length >= 4}
              className="pin-key"
            >
              {num}
            </button>
          ))}
          
          <button onClick={handleClear} className="pin-key clear">
            Clear
          </button>
          
          <button
            onClick={() => handleNumberClick('0')}
            disabled={pin.length >= 4}
            className="pin-key"
          >
            0
          </button>
          
          <button onClick={handleDelete} className="pin-key delete">
            <Delete size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}