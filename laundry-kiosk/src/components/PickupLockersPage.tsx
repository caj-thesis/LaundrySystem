import { PackageCheck, Clock, ArrowLeft, Lock } from 'lucide-react';
import type { Locker } from '../types';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface PickupLockersPageProps {
  lockers: Locker[];
  onSelectLocker: (lockerId: number) => void;
  onBack: () => void;
}

export function PickupLockersPage({ lockers, onSelectLocker, onBack }: PickupLockersPageProps) {
  
  const getStatusText = (status?: string) => {
    switch(status) {
      case 'Dropped': return 'Dropped (Waiting)';
      case 'Processing': return 'Processing';
      case 'Done': return 'Ready for Pickup';
      default: return 'Processing'; 
    }
  };

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
        <div className="available-lockers-container" style={{ marginTop: '12px'}}>
          <div className="instructions-header">
            <h2>Pickup Lockers</h2>
            <p>Select your locker to proceed with payment</p>
          </div>
        </div>

        {/* Return Button */}
        <button onClick={onBack} className="btn-return-absolute" style={{ zIndex: 10 }}>
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

        {/* Scrollable Grid Area - Removed flex:1 to prevent pushing content down */}
        <div className="pickup-grid" style={{ 
          overflowY: 'auto', 
          paddingTop: '20px', // Space between header and first card
          paddingBottom: '20px' 
        }}>
          
          <div className="pickup-grid-container" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
            gap: '12px',
            width: '100%',
            padding: '4px'
          }}>
            
            {lockers.length === 0 ? (
              <div className="no-data-message" style={{ 
                gridColumn: '1/-1', 
                textAlign: 'center', 
                padding: '2rem', 
                color: '#6b7280', 
                fontSize: '18px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
                // Removed height: 100% to keep it at the top
              }}>
                <PackageCheck size={64} style={{ marginBottom: '16px', opacity: 0.2 }} />
                No items ready for pickup currently.
              </div>
            ) : (
              lockers.map((locker) => {
                const isReady = locker.laundryStatus === 'Done';
                
                return (
                  <button
                    key={locker.id}
                    onClick={() => isReady && onSelectLocker(locker.id)}
                    className={`pickup-locker-button ${!isReady ? 'disabled' : ''}`}
                    disabled={!isReady}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '24px', 
                      backgroundColor: isReady ? 'white' : '#f3f4f6', 
                      border: isReady ? '2px solid transparent' : '2px dashed #d1d5db',
                      borderRadius: '16px',
                      boxShadow: isReady ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none',
                      cursor: isReady ? 'pointer' : 'not-allowed',
                      opacity: isReady ? 1 : 0.7,
                      transition: 'all 0.2s ease',
                      minHeight: '120px',
                      textAlign: 'left',
                      position: 'relative',
                      zIndex: 2 
                    }}
                  >
                    <div className="pickup-locker-left" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ 
                        backgroundColor: isReady ? '#dcfce7' : '#e5e7eb', 
                        padding: '12px', 
                        borderRadius: '50%', 
                        color: isReady ? '#16a34a' : '#9ca3af' 
                      }}>
                        {isReady ? <PackageCheck size={32} /> : <Lock size={32} />}
                      </div>
                      
                      <div className="pickup-locker-info">
                        <div className="pickup-locker-number" style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937' }}>
                          Locker {locker.id}
                        </div>
                        <div style={{ 
                          fontSize: '13px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '4px', 
                          marginTop: '2px',
                          color: isReady ? '#16a34a' : '#6b7280',
                          fontWeight: '500'
                        }}>
                          <Clock size={14} />
                          <span>{getStatusText(locker.laundryStatus)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="pickup-locker-right" style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                         {locker.weight?.toFixed(1) || 0} kg
                      </div>
                      {isReady && (
                        <div style={{ fontSize: '20px', fontWeight: '800', color: '#2563eb' }}>
                          ₱{locker.price?.toFixed(2) || '0.00'}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}