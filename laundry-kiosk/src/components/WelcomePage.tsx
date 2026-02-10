import { WashingMachine } from 'lucide-react';
import '../styles/BackgroundStyles.css';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface WelcomePageProps {
  onNext: () => void;
}

export function WelcomePage({ onNext }: WelcomePageProps) {
  return (
    <div className="welcome-page" style={{ position: 'relative' }}>
      <BackgroundBubbles variant="white" />

      <div className="welcome-content">
        <WashingMachine size={100} strokeWidth={1.5} />
        <div className="welcome-text">
          <h1 className="welcome-title">WELCOME</h1>
          <p className="welcome-subtitle">CAJ Laundry Locker System</p>
        </div>
      </div>
      
      <button onClick={onNext} className="btn-primary" style={{ position: 'relative', zIndex: 1 }}>
        Get Started
      </button>
    </div>
  );
}