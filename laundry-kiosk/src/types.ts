// src/types.ts
export interface Locker {
  id: number;
  capacity: string;
  size?: string; // Added 'size' to fix the property access issue
  status: 'available' | 'occupied';
  weight?: number; 
  price?: number;  
  readyTime?: string;
  pin?: string; 
  doorStatus?: string; 
}