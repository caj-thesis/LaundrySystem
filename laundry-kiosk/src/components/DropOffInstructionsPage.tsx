import { ArrowLeft } from 'lucide-react';

interface DropOffInstructionsPageProps {
  onNext: () => void;
  onBack: () => void;
}

export function DropOffInstructionsPage({ onNext, onBack }: DropOffInstructionsPageProps) {
  return (
    <div className="dropoff-instructions-page">
      <button onClick={onBack} className="btn-return-absolute">
        <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
        Return
      </button>
      
      <div className="instructions-container">
        <div className="instructions-header">
          <h2>Drop Off Service</h2>
          <p>How it works</p>
        </div>

        <div className="instructions-list">
          <div className="instruction-item">
            <div className="instruction-number">1</div>
            <div className="instruction-content">
              <h3>Select a Locker</h3>
              <p>Choose an available locker that fits your laundry size.</p>
            </div>
          </div>

          <div className="instruction-item">
            <div className="instruction-number">2</div>
            <div className="instruction-content">
              <h3>Place & Weigh</h3>
              <p>Place items inside. The smart scale will calculate the price.</p>
            </div>
          </div>
        </div>

        <button onClick={onNext} className="btn-full">
          Proceed to Locker Selection
        </button>
      </div>
    </div>
  );
}