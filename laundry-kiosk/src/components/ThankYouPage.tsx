import { CheckCircle } from 'lucide-react';
import { useEffect } from 'react';

interface ThankYouPageProps {
  processType: 'dropoff' | 'pickup';
  generatedPin?: string | null;
  transactionId?: string | null;
  price?: number; 
  weight?: number;
  onReset: () => void;
}

export function ThankYouPage({ processType, generatedPin, transactionId, price, weight, onReset }: ThankYouPageProps) {
  
  useEffect(() => {
    const triggerPrint = async () => {
      try {
        await fetch('http://localhost:3000/api/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId,
            pin: generatedPin,
            processType,
            weight: weight || 0,
            price: price || 0
          }),
        });
      } catch (error) {
        console.error("Print request failed:", error);
      }
    };

    if (transactionId) {
      triggerPrint();
    }

    // Existing timer to reset page
    const timer = setTimeout(() => {
      onReset();
    }, 10000);

    return () => clearTimeout(timer);
  }, [onReset, transactionId, generatedPin, processType, weight, price]);

  return (
    <div className="thankyou-page">
      <div className="thankyou-content">
        <CheckCircle size={100} strokeWidth={1.5} />
        <div className="thankyou-text">
          <h1 className="thankyou-title">Thank You!</h1>
          {transactionId && (
            <div className="text-sm font-mono text-gray-500 mb-4 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full inline-block">
              Transaction #: {transactionId}
            </div>
          )}
          {processType === 'dropoff' && (
            <div className="thankyou-messages">
              <p className="thankyou-message">Your laundry has been received</p>
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
        <p>Please take your receipt. Returning to home...</p>
      </div>
    </div>
  );
}