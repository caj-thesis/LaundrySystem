import { Lock, ArrowLeft } from 'lucide-react';

interface AvailableLockersPageProps {
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

const availableLockers = [
  { id: 1, size: 'Small', capacity: '5 kg' },
  { id: 2, size: 'Small', capacity: '5 kg' },
  { id: 3, size: 'Medium', capacity: '10 kg' },
  { id: 4, size: 'Medium', capacity: '10 kg' },
  { id: 5, size: 'Large', capacity: '15 kg' },
  { id: 7, size: 'Small', capacity: '5 kg' },
  { id: 9, size: 'Large', capacity: '15 kg' },
];

export function AvailableLockersPage({ onSelectLocker, onBack }: AvailableLockersPageProps) {
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
          {availableLockers.map((locker) => (
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
          ))}
        </div>
      </div>
    </div>
  );
}