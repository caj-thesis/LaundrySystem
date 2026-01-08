import { CheckCircle } from 'lucide-react';
import { useEffect } from 'react';

interface ThankYouPageProps {
  processType: 'dropoff' | 'pickup';
  generatedPin?: string | null; // New Prop
  onReset: () => void;
}

export function ThankYouPage({ processType, generatedPin, onReset }: ThankYouPageProps) {
  useEffect(() => {
    // Increased timer to 10s so user has time to read the PIN
    const timer = setTimeout(() => {
      onReset();
    }, 10000);

    return () => clearTimeout(timer);
  }, [onReset]);

  return (
    <div className="thankyou-page">
      <div className="thankyou-content">
        <CheckCircle size={100} strokeWidth={1.5} />
        
        <div className="thankyou-text">
          <h1 className="thankyou-title">Thank You!</h1>
          
          {processType === 'dropoff' && (
            <div className="thankyou-messages">
              <p className="thankyou-message">Your laundry has been received</p>
              
              {/* Inserted PIN Display here */}
              {generatedPin && (
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.1)', borderRadius: '8px', border: '1px dashed currentColor' }}>
                  <p style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '0.25rem' }}>Your Pickup PIN:</p>
                  <p style={{ fontSize: '2.5rem', fontWeight: 'bold', letterSpacing: '0.2em' }}>{generatedPin}</p>
                </div>
              )}
            </div>
          )}
          
          {processType === 'pickup' && (
            <div className="thankyou-messages">
              <p className="thankyou-message">Payment successful!</p>
              <p className="thankyou-submessage">Locker is now open</p>
            </div>
          )}
        </div>
      </div>

      <div className="thankyou-footer">
        <p>Returning to home screen...</p>
      </div>
    </div>
  );
}