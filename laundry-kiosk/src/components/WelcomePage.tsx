import { WashingMachine } from 'lucide-react';
import '../styles/BackgroundStyles.css'; 

interface WelcomePageProps {
  onNext: () => void;
}

export function WelcomePage({ onNext }: WelcomePageProps) {
  return (
    <div className="welcome-page">
      {/* Moving Bubbles Background Layer - Using the white variation for the blue background */}
      <div className="bubbles-container">
        <div className="bubble bubble-white"></div>
        <div className="bubble bubble-white"></div>
        <div className="bubble bubble-white"></div>
        <div className="bubble bubble-white"></div>
        <div className="bubble bubble-white"></div>
        <div className="bubble bubble-white"></div>
        <div className="bubble bubble-white"></div>
        <div className="bubble bubble-white"></div>
      </div>

      {/* Your original layout remains untouched */}
      <div className="welcome-content">
        <WashingMachine size={100} strokeWidth={1.5} />
        <div className="welcome-text">
          <h1 className="welcome-title">WELCOME</h1>
          <p className="welcome-subtitle">CAJ Laundry Locker System</p>
        </div>
      </div>
      
      <button onClick={onNext} className="btn-primary">
        Get Started
      </button>
    </div>
  );
}