import { useState, useEffect } from 'react';
import { Scale, DollarSign, Loader2, ArrowLeft } from 'lucide-react';

interface DropOffInstructionsPageProps {
  lockerId: number;
  currentWeight: number; 
  onComplete: (price: number, weight: number) => void;
  onBack: () => void;
}

export function DropOffInstructionsPage({ lockerId, currentWeight, onComplete, onBack }: DropOffInstructionsPageProps) {
  const [step, setStep] = useState<'instructions' | 'weighing' | 'summary'>('instructions');
  const [isWeighing, setIsWeighing] = useState(false);

  const pricePerKg = 25;
  const totalPrice = currentWeight * pricePerKg;

  // --- FIX: Auto-advance ONLY if weight > 0 ---
  useEffect(() => {
    let timer: NodeJS.Timeout;
    
    // Only start the countdown if we are weighing AND we detect weight
    if (isWeighing && currentWeight > 0) {
      timer = setTimeout(() => {
        setIsWeighing(false);
        setStep('summary');
      }, 3000); // Wait 3 seconds of stable weight before finishing
    }

    return () => clearTimeout(timer);
  }, [isWeighing, currentWeight]);

  const handleOpenLocker = async () => {
    try {
      setIsWeighing(true);
      
      // 1. Send Command to Backend to unlock
      await fetch('http://localhost:3000/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId }),
      }).catch(err => console.error("Unlock error:", err));

      setStep('weighing');
      
      // NOTE: Removed the "setTimeout" that blindly advanced after 4 seconds.
      // Now it waits for the useEffect above to detect weight.

    } catch (err) {
      console.error("Failed to unlock:", err);
      alert("Hardware connection failed");
      setIsWeighing(false);
    }
  };

  if (step === 'instructions') {
    return (
      <div className="dropoff-instructions-page">
        <button onClick={onBack} className="btn-return-absolute">
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>
        
        <div className="instructions-container">
          <div className="instructions-header">
            <h2>Locker {lockerId}</h2>
            <p>Drop Off Instructions</p>
          </div>

          <div className="instructions-list">
            <div className="instruction-item">
              <div className="instruction-number">1</div>
              <div className="instruction-content">
                <h3>Open the locker</h3>
                <p>Press the button below to unlock locker {lockerId}</p>
              </div>
            </div>

            <div className="instruction-item">
              <div className="instruction-number">2</div>
              <div className="instruction-content">
                <h3>Place your laundry</h3>
                <p>Put your laundry items inside the locker.</p>
              </div>
            </div>
          </div>

          <button onClick={handleOpenLocker} className="btn-full">
            Open Locker & Start Weighing
          </button>
        </div>
      </div>
    );
  }

  if (step === 'weighing') {
    return (
      <div className="weighing-page">
        <div className="weighing-content">
          <Scale size={80} className="animate-bounce" />
          
          <div>
            <h2 className="weighing-title">Reading Scale...</h2>
            
            <div className="weight-display">
              <div className="weight-label">Current Weight</div>
              <div className="weight-value">{currentWeight.toFixed(1)} <span>kg</span></div>
              
              <div className="weight-price">
                <div className="price-row">
                  <DollarSign size={20} />
                  <span>Estimated: ₱{totalPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="weighing-status">
              <Loader2 className="animate-spin" size={20} />
              {currentWeight <= 0 ? (
                <span>Waiting for items... (Place laundry inside)</span>
              ) : (
                <span>Weight detected. processing...</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'summary') {
    return (
      <div className="summary-page">
        <div className="page-header">
          <h2 className="page-title">Drop Off Summary</h2>
        </div>

        <div className="summary-content">
          <div className="summary-card">
            <div className="summary-weight">
              <div className="summary-weight-label">Total Weight</div>
              <div className="summary-weight-value">{currentWeight.toFixed(1)} kg</div>
            </div>
            
            <div className="summary-pricing">
              <div className="summary-row">
                <span className="label">Price per kg:</span>
                <span className="value">₱{pricePerKg.toFixed(2)}</span>
              </div>
              <div className="summary-row total">
                <span className="label">Total Amount:</span>
                <span className="value">₱{totalPrice.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="summary-actions">
            <button 
              // --- FIX: Disable button if weight is 0 ---
              disabled={currentWeight <= 0}
              onClick={() => onComplete(totalPrice, currentWeight)} 
              className="btn-full success"
              style={{ 
                opacity: currentWeight > 0 ? 1 : 0.5, 
                cursor: currentWeight > 0 ? 'pointer' : 'not-allowed' 
              }}
            >
              {currentWeight > 0 ? 'Confirm Drop Off' : 'No Weight Detected'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}