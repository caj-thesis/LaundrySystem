import { useState } from 'react';
import { Scale, DollarSign, Loader2, ArrowLeft } from 'lucide-react';

interface DropOffInstructionsPageProps {
  lockerId: number;
  currentWeight: number; // Added to match App.tsx
  onComplete: (price: number, weight: number) => void; // Updated to match App.tsx
  onBack: () => void;
}

export function DropOffInstructionsPage({ lockerId, currentWeight, onComplete, onBack }: DropOffInstructionsPageProps) {
  const [step, setStep] = useState<'instructions' | 'weighing' | 'summary'>('instructions');
  const [isWeighing, setIsWeighing] = useState(false);

  // Use the live weight passed from App.tsx
  const pricePerKg = 25;
  const totalPrice = currentWeight * pricePerKg;

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

      // 2. Wait for user to put clothes in (simulated delay for UX)
      // In a real scenario, you might wait for weight > 0
      setTimeout(() => {
        setIsWeighing(false);
        setStep('summary');
      }, 4000); 

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
              {/* Uses the prop from App.tsx which is updated by the global poller */}
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
              <span>Please place items and close door...</span>
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
              // CRITICAL FIX: Pass the calculated values back to App.tsx
              onClick={() => onComplete(totalPrice, currentWeight)} 
              className="btn-full success"
            >
              Confirm Drop Off
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}