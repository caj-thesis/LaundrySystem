import { PackagePlus, PackageCheck, ArrowLeft } from 'lucide-react';

interface ProcessSelectionPageProps {
  onSelect: (process: 'dropoff' | 'pickup') => void;
  onBack: () => void;
}

export function ProcessSelectionPage({ onSelect, onBack }: ProcessSelectionPageProps) {
  return (
    <div className="process-selection-page">
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
  );
}