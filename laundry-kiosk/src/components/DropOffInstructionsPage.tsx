import { useState, useEffect, useRef } from 'react';
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
  
  // Polling interval ref
  const pollInterval = useRef<number | null>(null);

  const pricePerKg = 25;
  const totalPrice = weight * pricePerKg;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, []);

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

      // 2. Start Polling for Weight
      pollInterval.current = window.setInterval(async () => {
        try {
          const res = await fetch('http://localhost:3000/api/status');
          const data = await res.json();
          
          let currentWeight = 0;
          
          // MAP REACT IDs TO ARDUINO DATA
          if (lockerId === 6) currentWeight = data.l1.weight;
          if (lockerId === 8) currentWeight = data.l2.weight;

          setWeight(currentWeight);

          // Logic: If weight is stable/valid, you might want a "Done" button 
          // or auto-detect. For now, we'll wait for user to click "Confirm" 
          // or simulated completion logic if specific weight is reached.
          
          // OPTIONAL: Auto-advance if weight > 0 and stable for x seconds
          // For now, let's keep it simple: stop spinner if weight > 0.5
          if (currentWeight > 0.5) {
             setIsWeighing(false); 
             // Stop polling and go to summary after short delay?
             // Or add a "Done Weighing" button. 
             // Let's mimic the previous auto-advance logic:
             setTimeout(() => {
                if (pollInterval.current) clearInterval(pollInterval.current);
                setStep('summary');
             }, 3000); 
          }

        } catch (error) {
          console.error("Error fetching status:", error);
        }
      }, 500); // Poll every 500ms

    } catch (err) {
      console.error("Failed to unlock:", err);
      alert("Hardware connection failed");
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
            Open Locker {lockerId} (Hardware)
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
              <div className="weight-value">{weight.toFixed(1)} <span>kg</span></div>
              
              <div className="weight-price">
                <div className="price-row">
                  <DollarSign size={20} />
                  <span>Estimated: ₱{totalPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {isWeighing && (
              <div className="weighing-status">
                <Loader2 className="animate-spin" size={20} />
                <span>Waiting for laundry...</span>
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
              <div className="summary-weight-value">{weight.toFixed(1)} kg</div>
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