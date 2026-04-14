import { Users, WashingMachine } from 'lucide-react';
import '../styles/BackgroundStyles.css';
import { BackgroundBubbles } from '../components/BackgroundBubbles';

interface WelcomePageProps {
  onNext: () => void;
  onSecretAdminAccess: () => void;
  shopName?: string;
}

export function WelcomePage({ onNext, onSecretAdminAccess, shopName }: WelcomePageProps) {
  return (
    <div className="welcome-page" style={{ position: 'relative' }}>
      <BackgroundBubbles variant="white" />

      <button
        type="button"
        onClick={onSecretAdminAccess}
        aria-label="Open admin PIN page"
        style={{
          position: 'absolute',
          top: '24px',
          right: '24px',
          minWidth: '108px',
          height: '42px',
          borderRadius: '999px',
          border: '1px solid rgba(255, 255, 255, 0.28)',
          background: 'rgba(15, 23, 42, 0.24)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '0 16px',
          boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
          backdropFilter: 'blur(8px)',
          zIndex: 2,
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 700,
          letterSpacing: '0.02em',
        }}
      >
        <Users size={18} strokeWidth={2.2} />
        <span>Admin</span>
      </button>

      <div className="welcome-content">
        <div>
          <WashingMachine size={100} strokeWidth={1.5} />
        </div>

        <div className="welcome-text">
          <h1 className="welcome-title">WELCOME</h1>
          <p className="welcome-subtitle">{shopName || 'CAJ Laundry Locker System'}</p>
        </div>
      </div>

      <button onClick={onNext} className="btn-primary" style={{ position: 'relative', zIndex: 1 }}>
        Get Started
      </button>
    </div>
  );
}
