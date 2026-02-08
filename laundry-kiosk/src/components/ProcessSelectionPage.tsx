import { PackagePlus, PackageCheck, ArrowLeft } from 'lucide-react';
import '../styles/BackgroundStyles.css'; 

interface ProcessSelectionPageProps {
  onSelect: (process: 'dropoff' | 'pickup') => void;
  onBack: () => void;
}

export function ProcessSelectionPage({ onSelect, onBack }: ProcessSelectionPageProps) {
  return (
    <div className="process-selection-page">
      {/* Background Layer with TINTED bubbles */}
      <div className="bubbles-container">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="bubble bubble-tinted"></div>
        ))}
      </div>

      {/* Rest of your layout remains identical */}
      <button onClick={onBack} className="btn-return-absolute btn-return">
        <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
        <span>Return</span>
      </button>

      <div className="page-header">
        <h2 className="page-title">Select Service</h2>
        <p className="page-subtitle">What would you like to do?</p>
      </div>

      <div className="process-selection-buttons">
        <button onClick={() => onSelect('dropoff')} className="process-button dropoff">
          <PackagePlus size={80} strokeWidth={1.5} />
          <div>
            <div className="process-button-title">Drop Off</div>
            <p className="process-button-desc">Place your laundry</p>
          </div>
        </button>

        <button onClick={() => onSelect('pickup')} className="process-button pickup">
          <PackageCheck size={80} strokeWidth={1.5} />
          <div>
            <div className="process-button-title">Pick Up</div>
            <p className="process-button-desc">Collect your laundry</p>
          </div>
        </button>
      </div>
    </div>
  );
}