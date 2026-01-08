import { PackageCheck, Clock, ArrowLeft } from 'lucide-react';
import type { Locker } from '../types'; // <--- CHANGED IMPORT

interface PickupLockersPageProps {
  lockers: Locker[];
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

export function PickupLockersPage({ lockers, onSelectLocker, onBack }: PickupLockersPageProps) {
  return (
    <div className="lockers-page">
      <div className="page-header">
        <h2 className="page-title">Ready for Pickup</h2>
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
            lockers.map((locker) => (
              <button
                key={locker.id}
                onClick={() => onSelectLocker(locker.id)}
                className="pickup-locker-button"
              >
                <div className="pickup-locker-left">
                  <PackageCheck size={40} className="pickup-locker-icon" />
                  <div className="pickup-locker-info">
                    <div className="pickup-locker-number">Locker {locker.id}</div>
                    <div className="pickup-locker-time">
                      <Clock size={14} />
                      <span>Ready {locker.readyTime || 'Now'}</span>
                    </div>
                  </div>
                </div>
                
                <div className="pickup-locker-right">
                  <div className="pickup-locker-weight">{locker.weight?.toFixed(1) || 0} kg</div>
                  <div className="pickup-locker-price">₱{locker.price?.toFixed(2) || '0.00'}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}