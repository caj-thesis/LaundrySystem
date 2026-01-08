import { useState, useEffect } from 'react';
import { Scale, DollarSign, Loader2, ArrowLeft } from 'lucide-react';

interface DropOffInstructionsPageProps {
  lockerId: number;
  currentWeight: number; // Receive live weight from App.tsx
  onComplete: (price: number, weight: number) => void; // FIX: Must accept args
  onBack: () => void;
}

export function DropOffInstructionsPage({ 
  lockerId, 
  currentWeight, 
  onComplete, 
  onBack 
}: DropOffInstructionsPageProps) {
  const [step, setStep] = useState<'instructions' | 'weighing' | 'summary'>('instructions');
  const [isWeighing, setIsWeighing] = useState(false);
  const [finalWeight, setFinalWeight] = useState(0);

  const pricePerKg = 25;
  // Calculate price based on the captured final weight, or live weight if weighing
  const displayWeight = step === 'summary' ? finalWeight : currentWeight;
  const totalPrice = displayWeight * pricePerKg;

  const handleOpenLocker = async () => {
    try {
      // 1. Send Command to Backend
      await fetch('http://localhost:3000/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockerId }),
      });

      setStep('weighing');
      setIsWeighing(true);

    } catch (err) {
      console.error("Failed to unlock:", err);
      // Proceed anyway in simulation mode
      setStep('weighing');
      setIsWeighing(true);
    }
  };

  // Monitor weight to auto-advance
  useEffect(() => {
    if (isWeighing && currentWeight > 0.5) {
      // Small delay to let weight settle
      const timer = setTimeout(() => {
        setIsWeighing(false);
        setFinalWeight(currentWeight);
        setStep('summary');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isWeighing, currentWeight]);

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
                <p>Press the button to unlock locker {lockerId}</p>
              </div>
            </div>

            <div className="instruction-item">
              <div className="instruction-number">2</div>
              <div className="instruction-content">
                <h3>Place your laundry</h3>
                <p>Put your laundry items inside the locker</p>
              </div>
            </div>

            <div className="instruction-item">
              <div className="instruction-number">3</div>
              <div className="instruction-content">
                <h3>Close the door</h3>
                <p>System will weigh and calculate the price</p>
              </div>
            </div>
          </div>

          <button onClick={handleOpenLocker} className="btn-full">
            Open Locker {lockerId}
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
              <div className="weight-label">Current Weight (Live)</div>
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
              <span>Waiting for laundry (Place {'>'} 0.5kg)...</span>
            </div>
            
            {/* Fail-safe button in case sensor is broken */}
            <button 
                onClick={() => { setFinalWeight(currentWeight || 1.0); setStep('summary'); }}
                style={{marginTop: '2rem', background: 'transparent', border: '1px solid #666', color: '#666', padding: '0.5rem 1rem', borderRadius: '4px', fontSize: '0.8rem'}}
            >
                Skip / Manual Override
            </button>
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
              <div className="summary-weight-value">{finalWeight.toFixed(1)} kg</div>
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
            <div className="info-box">
              <p>Your laundry has been received and will be processed</p>
            </div>

            {/* FIX: Pass arguments to onComplete */}
            <button onClick={() => onComplete(totalPrice, finalWeight)} className="btn-full success">
              Confirm Drop Off
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}