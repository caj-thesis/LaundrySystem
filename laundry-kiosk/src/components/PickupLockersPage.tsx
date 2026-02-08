import { PackageCheck, Clock, ArrowLeft, Lock } from 'lucide-react';
import type { Locker } from '../types';
import '../styles/BackgroundStyles.css';

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
      padding: '12px', // Minimal padding
      backgroundColor: '#f9fafb' 
    }}>
      
      {/* Background Layer with TINTED bubbles */}
      <div className="bubbles-container">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="bubble bubble-tinted"></div>
        ))}
      </div>

      {/* Header - Compacted */}
      <div className="page-header" style={{ marginBottom: '8px', textAlign: 'center', flexShrink: 0 }}>
        <h2 className="page-title" style={{ fontSize: '22px', fontWeight: 'bold', color: '#1f2937', marginBottom: '2px' }}>Pickup Locker</h2>
        <p className="page-subtitle" style={{ fontSize: '14px', color: '#4b5563' }}>Select your locker to proceed with payment</p>
      </div>

      {/* Return Button */}
      <button onClick={onBack} className="btn-return-top" style={{ top: '12px', right: '12px' }}>
        <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
        Return
      </button>

      {/* Scrollable Grid Area */}
      <div className="pickup-grid" style={{ 
        flex: 1, 
        overflowY: 'auto', 
        paddingBottom: '4px' 
      }}>
        
        <div className="pickup-grid-container" style={{
          display: 'grid',
          // Auto-fit with a larger min-width (280px) since these cards have more info
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: '12px',
          width: '100%',
          padding: '4px'
        }}>
          
          {lockers.length === 0 ? (
            <div className="no-data-message" style={{ 
              gridColumn: '1/-1', 
              textAlign: 'center', 
              padding: '3rem', 
              color: '#6b7280', 
              fontSize: '18px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: '300px'
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
                    flexDirection: 'row', // Keeping Row layout for info density
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '24px', 
                    backgroundColor: isReady ? 'white' : '#f3f4f6', // Grey out if not ready
                    border: isReady ? '2px solid transparent' : '2px dashed #d1d5db',
                    borderRadius: '16px',
                    boxShadow: isReady ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' : 'none',
                    cursor: isReady ? 'pointer' : 'not-allowed',
                    opacity: isReady ? 1 : 0.7,
                    transition: 'all 0.2s ease',
                    minHeight: '140px',
                    textAlign: 'left' // Reset text align for button contents
                  }}
                >
                  {/* LEFT SIDE: Icon & Details */}
                  <div className="pickup-locker-left" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {isReady ? (
                      <div style={{ backgroundColor: '#dcfce7', padding: '12px', borderRadius: '50%', color: '#16a34a' }}>
                        <PackageCheck size={36} />
                      </div>
                    ) : (
                      <div style={{ backgroundColor: '#e5e7eb', padding: '12px', borderRadius: '50%', color: '#9ca3af' }}>
                        <Lock size={36} />
                      </div>
                    )}
                    
                    <div className="pickup-locker-info">
                      <div className="pickup-locker-number" style={{ fontSize: '20px', fontWeight: 'bold', color: '#1f2937' }}>
                        Locker {locker.id}
                      </div>
                      
                      <div className="pickup-locker-time" style={{ 
                        fontSize: '14px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        marginTop: '4px',
                        color: isReady ? '#16a34a' : '#ef4444',
                        fontWeight: '500'
                      }}>
                        <Clock size={16} />
                        <span>{getStatusText(locker.laundryStatus)}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* RIGHT SIDE: Metrics */}
                  <div className="pickup-locker-right" style={{ textAlign: 'right' }}>
                    <div className="pickup-locker-weight" style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px', fontWeight: '500' }}>
                       {locker.weight?.toFixed(1) || 0} kg
                    </div>
                    
                    {isReady && (
                      <div className="pickup-locker-price" style={{ fontSize: '24px', fontWeight: '800', color: '#2563eb' }}>
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
  );
}