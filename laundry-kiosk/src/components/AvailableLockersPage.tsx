import { Lock, ArrowLeft } from 'lucide-react';
import type { Locker } from '../types';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface AvailableLockersPageProps {
  lockers: Locker[];
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

export function AvailableLockersPage({ lockers, onSelectLocker, onBack }: AvailableLockersPageProps) {
  const visibleLockers = lockers.filter(l => l.isConnected !== false);
  const isSingleLockerMode = visibleLockers.length === 1;

  return (
    <div className="lockers-page" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      padding: '12px', 
      backgroundColor: '#f9fafb',
      position: 'relative', // Necessary for absolute bubbles
      overflow: 'hidden'    // Contain the bubbles
    }}>
      
      {/* 1. Background Layer */}
      <BackgroundBubbles variant="tinted" />

      {/* 2. Content Layer - Relative & Z-Index to stay above bubbles */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        
        {/* Header */}
        <div className="page-header" style={{ marginBottom: '8px', textAlign: 'center', flexShrink: 0 }}>
          <h2 className="page-title" style={{ fontSize: '22px', fontWeight: 'bold', color: '#1f2937', marginBottom: '2px' }}>Available Lockers</h2>
          <p className="page-subtitle" style={{ fontSize: '14px', color: '#4b5563' }}>Select a locker for your laundry</p>
        </div>

        {/* Return Button */}
        <button 
          onClick={onBack} 
          className="btn-return-top" 
          style={{ top: '12px', right: '12px', zIndex: 10 }}
        >
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

        {/* Scrollable Grid Area */}
        <div className="lockers-grid" style={{ 
          flex: 1, 
          overflowY: 'auto', 
          paddingBottom: '4px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          
          <div className="lockers-grid-container" style={{
            display: 'grid',
            gridTemplateColumns: isSingleLockerMode ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))', 
            gap: '12px',
            padding: '4px',
            width: '100%'
          }}>
            {lockers.map((locker) => {
              const isOnline = locker.isConnected !== false;
              if (!isOnline) return null; 

              const isAvailable = locker.status === 'available';
              const isOccupied = locker.status === 'occupied';

              let bgColor = 'white';
              let borderColor = '#e5e7eb';
              let iconColor = '#9ca3af';
              let statusText = isAvailable ? 'Available' : 'Occupied';
              let statusColor = isAvailable ? '#10b981' : '#ef4444';

              if (isOccupied) {
                bgColor = '#fef2f2';
                borderColor = '#fecaca';
                iconColor = '#ef4444';
              } else {
                bgColor = '#ecfdf5';
                borderColor = '#a7f3d0';
                iconColor = '#10b981';
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
                    flexDirection: isSingleLockerMode ? 'row' : 'column',
                    aspectRatio: isSingleLockerMode ? 'auto' : '1/1',
                    height: isSingleLockerMode ? '140px' : 'auto', 
                    gap: isSingleLockerMode ? '24px' : '0px',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isAvailable ? 'pointer' : 'not-allowed',
                    opacity: isAvailable ? 1 : 0.8,
                    transition: 'all 0.2s ease',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    width: '100%',
                    position: 'relative', // Ensure content inside button stays above bubble layer
                    zIndex: 2
                  }}
                >
                  <div style={{
                    backgroundColor: 'white',
                    borderRadius: '50%',
                    padding: isSingleLockerMode ? '16px' : '12px',
                    marginBottom: isSingleLockerMode ? '0px' : '12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}>
                    <Lock size={isSingleLockerMode ? 32 : 28} color={iconColor} strokeWidth={2.5} />
                  </div>

                  <div style={{
                     display: 'flex',
                     flexDirection: 'column',
                     alignItems: isSingleLockerMode ? 'flex-start' : 'center',
                     justifyContent: 'center'
                  }}>
                      <span className="locker-id" style={{ 
                        fontSize: isSingleLockerMode ? '24px' : '18px', 
                        fontWeight: 'bold', 
                        color: '#374151',
                        marginBottom: '4px'
                      }}>
                        Locker {locker.id}
                      </span>

                      <span className="locker-status" style={{ 
                        fontSize: isSingleLockerMode ? '16px' : '14px', 
                        fontWeight: '600', 
                        color: statusColor,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        {statusText}
                      </span>

                      <span className="locker-capacity" style={{ 
                        fontSize: '12px', 
                        color: '#6b7280', 
                        marginTop: '4px' 
                      }}>
                        Max: {locker.capacity}
                      </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}