import { Package } from 'lucide-react';

interface WelcomePageProps {
  onNext: () => void;
}

export function WelcomePage({ onNext }: WelcomePageProps) {
  return (
    <div className="welcome-page">
      <div className="welcome-content">
        <Package size={100} strokeWidth={1.5} />
        <div className="welcome-text">
          <h1 className="welcome-title">Welcome</h1>
          <p className="welcome-subtitle">Laundry Locker System</p>
        </div>
      </div>
      
      <button onClick={onNext} className="btn-primary">
        Get Started
      </button>
    </div>
  );
}