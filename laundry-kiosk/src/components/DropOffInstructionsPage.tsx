import { useState } from 'react';
import { Scale, DollarSign, Loader2, ArrowLeft } from 'lucide-react';

interface DropOffInstructionsPageProps {
  lockerId: number;
  onComplete: () => void;
  onBack: () => void;
}

export function DropOffInstructionsPage({ lockerId, onComplete, onBack }: DropOffInstructionsPageProps) {
  const [step, setStep] = useState<'instructions' | 'weighing' | 'summary'>('instructions');
  const [weight, setWeight] = useState(0);
  const [isWeighing, setIsWeighing] = useState(false);
  
  const pricePerKg = 25;
  const totalPrice = weight * pricePerKg;

  const handleOpenLocker = () => {
    setStep('weighing');
    setIsWeighing(true);
    
    setTimeout(() => {
      let currentWeight = 0;
      const interval = setInterval(() => {
        currentWeight += 0.5;
        setWeight(parseFloat(currentWeight.toFixed(1)));
        
        if (currentWeight >= 7.5) {
          clearInterval(interval);
          setIsWeighing(false);
          setTimeout(() => {
            setStep('summary');
          }, 1000);
        }
      }, 300);
    }, 2000);
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
            <h2 className="weighing-title">Weighing...</h2>
            
            <div className="weight-display">
              <div className="weight-label">Current Weight</div>
              <div className="weight-value">{weight} <span>kg</span></div>
              
              <div className="weight-price">
                <div className="price-row">
                  <DollarSign size={20} />
                  <span>Estimated: ₱{totalPrice.toFixed(2)}</span>
                </div>
                <div className="price-note">₱{pricePerKg.toFixed(2)} per kg</div>
              </div>
            </div>

            {isWeighing && (
              <div className="weighing-status">
                <Loader2 className="animate-spin" size={20} />
                <span>Please close the locker door...</span>
              </div>
            )}
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
              <div className="summary-weight-value">{weight} kg</div>
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
              <p>
                Your laundry has been received and will be processed
              </p>
            </div>

            <button onClick={onComplete} className="btn-full success">
              Confirm Drop Off
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}