import { useState, useEffect } from 'react';
import { WashingMachine } from 'lucide-react';
import '../styles/BackgroundStyles.css';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface WelcomePageProps {
  onNext: () => void;
  onSecretAdminAccess: () => void; // New prop to handle secret access
  shopName?: string; 
}

export function WelcomePage({ onNext, onSecretAdminAccess, shopName }: WelcomePageProps) {
  const [clickCount, setClickCount] = useState(0);

  // Reset the click count if the user pauses clicking for more than 1 second
  useEffect(() => {
    if (clickCount > 0) {
      const timer = setTimeout(() => setClickCount(0), 1000);
      return () => clearTimeout(timer);
    }
  }, [clickCount]);

  const handleSecretClick = () => {
    const newCount = clickCount + 1;
    setClickCount(newCount);
    
    // Trigger admin access on 5 rapid clicks
    if (newCount >= 5) {
      onSecretAdminAccess();
      setClickCount(0);
    }
  };

  return (
    <div className="welcome-page" style={{ position: 'relative' }}>
      <BackgroundBubbles variant="white" />

      <div className="welcome-content">
        {/* Wrap the icon in a clickable div to capture the secret taps */}
        <div onClick={handleSecretClick} style={{ cursor: 'pointer' }}>
          <WashingMachine size={100} strokeWidth={1.5} />
        </div>
        
        <div className="welcome-text">
          <h1 className="welcome-title">WELCOME</h1>
          <p className="welcome-subtitle">{shopName || "CAJ Laundry Locker System"}</p>
        </div>
      </div>
      
      <button onClick={onNext} className="btn-primary" style={{ position: 'relative', zIndex: 1 }}>
        Get Started
      </button>
    </div>
  );
}