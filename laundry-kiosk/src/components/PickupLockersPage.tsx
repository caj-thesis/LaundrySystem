import { PackageCheck, Clock, ArrowLeft, Lock } from 'lucide-react';
import type { Locker } from '../types';

interface PickupLockersPageProps {
  lockers: Locker[];
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

export function PickupLockersPage({ lockers, onSelectLocker, onBack }: PickupLockersPageProps) {
  
  // Helper to format status text
  const getStatusText = (status?: string) => {
    switch(status) {
      case 'Dropped': return 'Dropped (Waiting)';
      case 'Processing': return 'Processing'; // Changed to explicitly say Processing
      case 'Done': return 'Ready for Pickup';
      // Fallback: If status is undefined but locker is occupied, show "Processing"
      default: return 'Processing'; 
    }
  };

  return (
    <div className="lockers-page">
      <div className="page-header">
        <h2 className="page-title">Pickup Locker</h2>
        <p className="page-subtitle">Select your locker to proceed with payment</p>
      </div>

      <button onClick={onBack} className="btn-return-top">
        <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
        Return
      </button>

      <div className="pickup-grid">
        <div className="pickup-grid-container">
          {lockers.length === 0 ? (
            <div className="no-data-message" style={{textAlign: 'center', gridColumn: '1/-1', padding: '2rem'}}>
              No items ready for pickup currently.
            </div>
          ) : (
            lockers.map((locker) => {
              // Only allow selection if status is 'Done'
              const isReady = locker.laundryStatus === 'Done';
              
              return (
                <button
                  key={locker.id}
                  onClick={() => isReady && onSelectLocker(locker.id)}
                  className={`pickup-locker-button ${!isReady ? 'disabled' : ''}`}
                  disabled={!isReady}
                  style={{ opacity: isReady ? 1 : 0.6, cursor: isReady ? 'pointer' : 'not-allowed' }}
                >
                  <div className="pickup-locker-left">
                    {isReady ? (
                      <PackageCheck size={40} className="pickup-locker-icon" />
                    ) : (
                      // Show Lock icon for items that are still processing
                      <Lock size={40} className="pickup-locker-icon" style={{color: '#999'}} />
                    )}
                    
                    <div className="pickup-locker-info">
                      <div className="pickup-locker-number">Locker {locker.id}</div>
                      <div className="pickup-locker-time">
                        <Clock size={14} />
                        {/* Status Text Display */}
                        <span style={{ 
                          color: isReady ? 'inherit' : '#e63946', 
                          fontWeight: isReady ? 'normal' : 'bold' 
                        }}>
                          {getStatusText(locker.laundryStatus)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="pickup-locker-right">
                    <div className="pickup-locker-weight">{locker.weight?.toFixed(1) || 0} kg</div>
                    {/* Only show price when ready to pay */}
                    {isReady && (
                      <div className="pickup-locker-price">₱{locker.price?.toFixed(2) || '0.00'}</div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}