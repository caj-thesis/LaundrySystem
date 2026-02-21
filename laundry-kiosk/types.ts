export interface Locker {
  id: number;
  capacity: string;
  status: 'available' | 'occupied';
  weight?: number; 
  price?: number;  
  readyTime?: string;
  pin?: string; 
  doorStatus?: string;
  laundryStatus?: 'Dropped' | 'Processing' | 'Done';
  isConnected?: boolean; 
  currentTransactionId?: string;
}