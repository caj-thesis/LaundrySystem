import { Lock, ArrowLeft } from 'lucide-react';
import type { Locker } from '../types';
import '../styles/BackgroundStyles.css';

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
      padding: '12px', // Minimal padding to maximize internal space
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
        <h2 className="page-title" style={{ fontSize: '22px', fontWeight: 'bold', color: '#1f2937', marginBottom: '2px' }}>Available Lockers</h2>
        <p className="page-subtitle" style={{ fontSize: '14px', color: '#4b5563' }}>Select a locker for your laundry</p>
      </div>

      {/* Return Button - Absolute positioning to save header space if desired, or kept in flow */}
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
          // DYNAMIC LAYOUT:
          // 'auto-fit' collapses empty tracks, forcing the items to STRETCH to fill the width.
          // 'minmax(200px, 1fr)' ensures they are at least 200px wide, but grow (1fr) to fill.
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '12px',
          width: '100%',
          padding: '4px' // Prevent shadow clipping
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
              <Lock size={64} style={{ marginBottom: '16px', opacity: 0.2 }} />
              No lockers available for drop-off at the moment.
            </div>
          ) : (
            lockers.map((locker) => (
              <button
                key={locker.id}
                onClick={() => onSelectLocker(locker.id)}
                className="locker-button"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '24px', 
                  backgroundColor: 'white',
                  border: '2px solid transparent',
                  borderRadius: '16px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  minHeight: '180px' // Increased height to consume vertical space
                }}
              >
                <div style={{ 
                  backgroundColor: '#eff6ff', 
                  padding: '16px', // Larger icon padding
                  borderRadius: '50%', 
                  marginBottom: '16px',
                  color: '#2563eb' 
                }}>
                  <Lock size={40} /> {/* Larger Icon */}
                </div>
                
                <div className="locker-number" style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937' }}>
                  Locker {locker.id}
                </div>
                
                <div className="locker-capacity" style={{ fontSize: '16px', color: '#6b7280', marginTop: '4px' }}>
                  Max: {locker.capacity}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}