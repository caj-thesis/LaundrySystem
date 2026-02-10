import { PackagePlus, PackageCheck, ArrowLeft } from 'lucide-react';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface ProcessSelectionPageProps {
  onSelect: (process: 'dropoff' | 'pickup') => void;
  onBack: () => void;
}

export function ProcessSelectionPage({ onSelect, onBack }: ProcessSelectionPageProps) {
  return (
    /* 1. Added relative/hidden here to keep bubbles contained */
    <div className="process-selection-page" style={{ position: 'relative', overflow: 'hidden' }}>
      
      {/* 2. Place component at the top of the container */}
      <BackgroundBubbles variant="tinted" />

      {/* 3. Wrap existing content in a relative div to stay ABOVE bubbles */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="page-header">
          <h2 className="page-title">Select Service</h2>
          <p className="page-subtitle">What would you like to do?</p>
        </div>

        <button onClick={onBack} className="btn-return-top">
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

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
    </div>
  );
}