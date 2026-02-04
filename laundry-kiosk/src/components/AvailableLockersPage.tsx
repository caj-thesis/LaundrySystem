import { Lock, ArrowLeft } from 'lucide-react';
import type { Locker } from '../types';

interface AvailableLockersPageProps {
  lockers: Locker[];
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

export function AvailableLockersPage({ lockers, onSelectLocker, onBack }: AvailableLockersPageProps) {
  return (
    <div className="lockers-page" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      padding: '12px', 
      backgroundColor: '#f9fafb' 
    }}>
      
      {/* Header */}
      <div className="page-header" style={{ marginBottom: '8px', textAlign: 'center', flexShrink: 0 }}>
        <h2 className="page-title" style={{ fontSize: '22px', fontWeight: 'bold', color: '#1f2937', marginBottom: '2px' }}>Available Lockers</h2>
        <p className="page-subtitle" style={{ fontSize: '14px', color: '#4b5563' }}>Select a locker for your laundry</p>
      </div>

      {/* Return Button */}
      <button onClick={onBack} className="btn-return-top" style={{ top: '12px', right: '12px' }}>
        <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
        Return
      </button>

      {/* Scrollable Grid Area */}
      <div className="lockers-grid" style={{ 
        flex: 1, 
        overflowY: 'auto', 
        paddingBottom: '4px' 
      }}>
        
        <div className="lockers-grid-container" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
          gap: '12px',
          padding: '4px'
        }}>
          {lockers.map((locker) => {
            // 1. CHECK CONNECTION
            const isOnline = locker.isConnected !== false;

            // 2. FILTER: If offline, don't render anything
            if (!isOnline) {
                return null; 
            }

            // 3. Determine Status
            const isAvailable = locker.status === 'available';
            const isOccupied = locker.status === 'occupied';

            // Base styles
            let bgColor = 'white';
            let borderColor = '#e5e7eb';
            let iconColor = '#9ca3af';
            let statusText = isAvailable ? 'Available' : 'Occupied';
            let statusColor = isAvailable ? '#10b981' : '#ef4444';

            // OCCUPIED STYLING
            if (isOccupied) {
              bgColor = '#fef2f2'; // Light Red
              borderColor = '#fecaca';
              iconColor = '#ef4444';
              statusText = 'In Use';
              statusColor = '#ef4444';
            } else {
              // AVAILABLE STYLING
              bgColor = '#ecfdf5'; // Light Green
              borderColor = '#a7f3d0';
              iconColor = '#10b981';
              statusText = 'Available';
              statusColor = '#10b981';
            }

            return (
              <button
                key={locker.id}
                onClick={() => onSelectLocker(locker.id)}
                disabled={!isAvailable} 
                className={`locker-card ${isAvailable ? 'available' : 'unavailable'}`}
                style={{
                  backgroundColor: bgColor,
                  border: `2px solid ${borderColor}`,
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: isAvailable ? 'pointer' : 'not-allowed',
                  opacity: isAvailable ? 1 : 0.8,
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                  aspectRatio: '1/1'
                }}
              >
                {/* Icon Circle */}
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '50%',
                  padding: '12px',
                  marginBottom: '12px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}>
                  <Lock size={28} color={iconColor} strokeWidth={2.5} />
                </div>

                {/* Locker Name */}
                <span className="locker-id" style={{ 
                  fontSize: '18px', 
                  fontWeight: 'bold', 
                  color: '#374151',
                  marginBottom: '4px'
                }}>
                  Locker {locker.id}
                </span>

                {/* Status Text */}
                <span className="locker-status" style={{ 
                  fontSize: '14px', 
                  fontWeight: '600', 
                  color: statusColor,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  {statusText}
                </span>

                {/* Capacity */}
                <span className="locker-capacity" style={{ 
                  fontSize: '12px', 
                  color: '#6b7280', 
                  marginTop: '4px' 
                }}>
                  Max: {locker.capacity}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}