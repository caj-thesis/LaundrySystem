import React from 'react';
import '../styles/app.css';

interface AdminPageProps {
  onBack: () => void;
}

export function AdminPage({ onBack }: AdminPageProps) {
  return (
    <div className="admin-page" style={{ padding: '20px', backgroundColor: '#fff', height: '100%', width: '100%', zIndex: 100, position: 'absolute' }}>
      <h1>Admin Dashboard</h1>
      <p>Welcome to the secret admin control panel.</p>
      
      {/* Add your admin controls here (e.g., manually opening lockers, checking system status) */}
      
      <button onClick={onBack} className="btn-primary" style={{ marginTop: '20px' }}>
        Exit Admin Mode
      </button>
    </div>
  );
}