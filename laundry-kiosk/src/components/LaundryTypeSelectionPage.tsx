import { ArrowLeft, Shirt, BedDouble } from 'lucide-react';

interface LaundryTypeSelectionPageProps {
  onSelect: (price: number) => void;
  onBack: () => void;
}

export function LaundryTypeSelectionPage({ onSelect, onBack }: LaundryTypeSelectionPageProps) {
  return (
    <div className="process-selection-page">
      <div className="page-header">
        <h2 className="page-title">Laundry Type</h2>
        <p className="page-subtitle">Select the type of items you are washing</p>
      </div>

      <button onClick={onBack} className="btn-return-top">
        <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
        Return
      </button>

      <div className="process-selection-buttons">
        {/* Option 1: Regular Clothes */}
        <button 
          onClick={() => onSelect(25)} 
          className="process-button"
          style={{ borderColor: '#3b82f6', backgroundColor: '#eff6ff' }} // Blue theme
        >
          <div style={{ color: '#2563eb', marginBottom: '16px' }}>
            <Shirt size={80} strokeWidth={1.5} />
          </div>
          <div>
            <div className="process-button-title" style={{ color: '#1e40af' }}>Clothes</div>
            <p className="process-button-desc">Regular Wear</p>
            <div style={{ 
              marginTop: '12px', 
              fontSize: '24px', 
              fontWeight: 'bold', 
              color: '#2563eb' 
            }}>
              ₱25 <span style={{ fontSize: '16px', fontWeight: 'normal' }}>/ kg</span>
            </div>
          </div>
        </button>

        {/* Option 2: Bed Sheets / Heavy */}
        <button 
          onClick={() => onSelect(40)} 
          className="process-button"
          style={{ borderColor: '#8b5cf6', backgroundColor: '#f5f3ff' }} // Violet theme
        >
          <div style={{ color: '#7c3aed', marginBottom: '16px' }}>
            <BedDouble size={80} strokeWidth={1.5} />
          </div>
          <div>
            <div className="process-button-title" style={{ color: '#5b21b6' }}>Bed Sheets</div>
            <p className="process-button-desc">Linens & Heavy Items</p>
            <div style={{ 
              marginTop: '12px', 
              fontSize: '24px', 
              fontWeight: 'bold', 
              color: '#7c3aed' 
            }}>
              ₱40 <span style={{ fontSize: '16px', fontWeight: 'normal' }}>/ kg</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}