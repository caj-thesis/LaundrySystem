import { ArrowLeft, Shirt, BedDouble } from 'lucide-react';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface LaundryTypeSelectionPageProps {
  onSelect: (price: number, type: string) => void;
  onBack: () => void;
}

export function LaundryTypeSelectionPage({ onSelect, onBack }: LaundryTypeSelectionPageProps) {
  return (
    /* Apply relative positioning and hide overflow for the bubble container */
    <div className="process-selection-page" style={{ position: 'relative', overflow: 'hidden' }}>
      
      <BackgroundBubbles variant="tinted" />

      {/* Wrapping the main content to ensure it stays on top of the bubbles */}
         <div className="available-lockers-container" style={{ marginTop: '12px'}}>
          <div className="instructions-header">
            <h2>Laundry Type</h2>
            <p>Select the type of your laundry items</p>
          </div>
        </div>

        <button onClick={onBack} className="btn-return-absolute" style={{ zIndex: 10 }}>
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

        <div className="process-selection-buttons">
          {/* Option 1: Regular Clothes */}
          <button 
            onClick={() => onSelect(25, 'Clothes')} 
            className="process-button"
            style={{ borderColor: '#3b82f6', backgroundColor: '#eff6ff' }} 
          >
            <div style={{ color: '#2563eb', marginBottom: '16px' }}>
              < Shirt size={80} strokeWidth={1.5} />
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
            onClick={() => onSelect(40, 'Bed Sheets')} 
            className="process-button"
            style={{ borderColor: '#8b5cf6', backgroundColor: '#f5f3ff' }}
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