import { Lock, ArrowLeft } from 'lucide-react';
import type { Locker } from '../App'; // <--- FIX: Added 'type' keyword

interface AvailableLockersPageProps {
  lockers: Locker[];
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

export function AvailableLockersPage({ lockers, onSelectLocker, onBack }: AvailableLockersPageProps) {
  return (
    <div className="lockers-page">
      <div className="page-header">
        <h2 className="page-title">Available Lockers</h2>
        <p className="page-subtitle">Select a locker for your laundry</p>
      </div>

      <button onClick={onBack} className="btn-return-top">
        <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
        Return
      </button>

      <div className="lockers-grid">
        <div className="lockers-grid-container">
          {lockers.length === 0 ? (
            <div className="no-data-message" style={{textAlign: 'center', gridColumn: '1/-1', padding: '2rem'}}>
              No lockers available for drop-off at the moment.
            </div>
          ) : (
            lockers.map((locker) => (
              <button
                key={locker.id}
                onClick={() => onSelectLocker(locker.id)}
                className="locker-button"
              >
                <Lock size={32} className="locker-icon" />
                <div className="locker-number">Locker {locker.id}</div>
                <div className="locker-size">{locker.size}</div>
                <div className="locker-capacity">Max: {locker.capacity}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}