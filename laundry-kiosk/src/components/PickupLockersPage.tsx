import { PackageCheck, Clock, ArrowLeft } from 'lucide-react';

interface PickupLockersPageProps {
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

const readyLockers = [
  { id: 6, weight: 8.5, price: 212.5, readyTime: '2 hours ago' },
  { id: 8, weight: 6.0, price: 150.0, readyTime: '5 hours ago' },
  { id: 10, weight: 12.5, price: 312.5, readyTime: '1 day ago' },
  { id: 12, weight: 4.5, price: 112.5, readyTime: '3 hours ago' },
];

export function PickupLockersPage({ onSelectLocker, onBack }: PickupLockersPageProps) {
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
          {readyLockers.map((locker) => (
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
                    <span>Ready {locker.readyTime}</span>
                  </div>
                </div>
              </div>
              
              <div className="pickup-locker-right">
                <div className="pickup-locker-weight">{locker.weight} kg</div>
                <div className="pickup-locker-price">₱{locker.price.toFixed(2)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}