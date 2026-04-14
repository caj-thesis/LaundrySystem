import '../styles/BackgroundStyles.css';

interface BackgroundBubblesProps {
  variant: 'white' | 'tinted';
}

export function BackgroundBubbles({ variant }: BackgroundBubblesProps) {
  return (
    <div 
      className="bubble-container" 
      style={{ 
        position: 'absolute', 
        inset: 0, 
        pointerEvents: 'none', 
        zIndex: 0,
        overflow: 'hidden' 
      }}
    >
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
      <div className={`bubble bubble-${variant}`}></div>
    </div>
  );
}