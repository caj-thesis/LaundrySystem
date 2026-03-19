export interface Locker {
  id: number;
  capacity: string;
  status: 'available' | 'occupied';
  weight?: number;
  price?: number;
  readyTime?: string;
  pin?: string;
  doorStatus?: string;
  laundryStatus?: 'Dropped' | 'Washing' | 'Done';
  isConnected?: boolean;
  currentTransactionId?: string;
}
