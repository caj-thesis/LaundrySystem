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
      position: 'relative', 
      overflow: 'hidden'    
    }}>
      
      {/* 1. Background Layer */}
      <BackgroundBubbles variant="tinted" />

      {/* 2. Content Layer */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        
        {/* Header Section */}
        <div className="available-lockers-container" style={{ 
          marginTop: '12px', 
          position: 'relative', 
          zIndex: 1,
          marginBottom: '10px' // <-- FIXED: Reduced bottom space of the header container
        }}>
          <div className="instructions-header">
            {/* <-- FIXED: Removed default browser margins from text to pull grid closer */}
            <h2 style={{ margin: '0 0 4px 0' }}>Available Lockers</h2>
            <p style={{ margin: '0' }}>Select a locker for your laundry</p>
          </div>
        </div>

        {/* Return Button */}
        <button onClick={onBack} className="btn-return-absolute" style={{ zIndex: 10 }}>
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

        {/* Scrollable Grid Area */}
        <div className="lockers-grid" style={{ 
          flex: 1, 
          overflowY: 'auto', 
          paddingBottom: '4px',
          display: 'flex',
          flexDirection: 'column',
          marginTop: '0px', // <-- FIXED: Removed the top gap completely
          justifyContent: 'flex-start' 
        }}>
          
   <div className="lockers-grid-container" style={{
            display: 'grid',
            gridTemplateColumns: isSingleLockerMode ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '12px',
            padding: '4px',
            width: '100%',
            // Optional: If single mode looks too wide, you can limit maxWidth here
            maxWidth: isSingleLockerMode ? '100%' : '100%'
          }}>

            {lockers.map((locker) => {
              const isOnline = locker.isConnected !== false;
              if (!isOnline) return null;
              const isAvailable = locker.status === 'available';
              const isOccupied = locker.status === 'occupied';

              let bgColor = isOccupied ? '#fef2f2' : '#ecfdf5';
              let borderColor = isOccupied ? '#fecaca' : '#a7f3d0';
              let iconColor = isOccupied ? '#ef4444' : '#10b981';
              let statusText = isOccupied ? 'In Use' : 'Available';
              let statusColor = isOccupied ? '#ef4444' : '#10b981';

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
                    position: 'relative',
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
                    <span style={{ 
                      fontSize: isSingleLockerMode ? '24px' : '18px', 
                      fontWeight: 'bold', 
                      color: '#374151',
                      marginBottom: '4px'
                    }}>
                      Locker {locker.id}
                    </span>

                    <span style={{ 
                      fontSize: isSingleLockerMode ? '16px' : '14px', 
                      fontWeight: '600', 
                      color: statusColor,
                      textTransform: 'uppercase'
                    }}>
                      {statusText}
                    </span>

                    <span style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
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