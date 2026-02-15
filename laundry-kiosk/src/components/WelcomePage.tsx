import { WashingMachine } from 'lucide-react';
import '../styles/BackgroundStyles.css';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface WelcomePageProps {
  onNext: () => void;
  shopName?: string; // Add optional prop
}

export function WelcomePage({ onNext, shopName }: WelcomePageProps) {
  return (
    <div className="welcome-page" style={{ position: 'relative' }}>
      <BackgroundBubbles variant="white" />

      <div className="welcome-content">
        <WashingMachine size={100} strokeWidth={1.5} />
        <div className="welcome-text">
          <h1 className="welcome-title">WELCOME</h1>
          {/* Use the dynamic shopName or fallback to default */}
          <p className="welcome-subtitle">{shopName || "CAJ Laundry Locker System"}</p>
        </div>
      </div>
      
      <button onClick={onNext} className="btn-primary" style={{ position: 'relative', zIndex: 1 }}>
        Get Started
      </button>
    </div>
  );
}