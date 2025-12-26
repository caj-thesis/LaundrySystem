import { CheckCircle } from 'lucide-react';
import { useEffect } from 'react';

interface ThankYouPageProps {
  processType: 'dropoff' | 'pickup';
  onReset: () => void;
}

export function ThankYouPage({ processType, onReset }: ThankYouPageProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onReset();
    }, 5000);

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