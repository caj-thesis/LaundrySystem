import React, { useState, useEffect } from 'react';
import { Lock, Unlock, Printer, RefreshCw, AlertCircle, Info, ArrowLeft } from 'lucide-react';
import '../styles/app.css';

// --- Types ---
type LaundryStatus = 'Available' | 'Dropped' | 'Washing' | 'Ready for Pick-up' | 'Done';

interface Transaction {
  id: string;
  customerName: string;
  phone: string;
  weight: number;
  laundryType: string;
  laundryStatus: LaundryStatus;
  reminderSent: boolean;
  timestamp: string;
}

interface Locker {
  id: string;
  lockerNumber: number;
  isLocked: boolean;
  currentTransactionId?: string; // If present, indicates an ongoing transaction
}

// --- Mock Data (Replace with your Firebase/Backend fetch logic later) ---
const mockLockers: Locker[] = [
  { id: 'L1', lockerNumber: 1, isLocked: true, currentTransactionId: 'T001' },
  { id: 'L2', lockerNumber: 2, isLocked: false },
  { id: 'L3', lockerNumber: 3, isLocked: true, currentTransactionId: 'T002' },
  { id: 'L4', lockerNumber: 4, isLocked: true, currentTransactionId: 'T003' },
];

const mockTransactions: Record<string, Transaction> = {
  'T001': { id: 'T001', customerName: 'John Doe', phone: '09123456789', weight: 5, laundryType: 'Wash & Fold', laundryStatus: 'Dropped', reminderSent: false, timestamp: '2026-03-16T10:00:00Z' },
  'T002': { id: 'T002', customerName: 'Jane Smith', phone: '09987654321', weight: 3, laundryType: 'Dry Clean', laundryStatus: 'Washing', reminderSent: false, timestamp: '2026-03-16T11:30:00Z' },
  'T003': { id: 'T003', customerName: 'Alice Johnson', phone: '09112223333', weight: 7, laundryType: 'Comforters', laundryStatus: 'Done', reminderSent: true, timestamp: '2026-03-14T09:00:00Z' }, // Overdue example
};

interface AdminPageProps {
  onBack: () => void;
}

export function AdminPage({ onBack }: AdminPageProps) {
  const [lockers, setLockers] = useState<Locker[]>(mockLockers);
  const [selectedLocker, setSelectedLocker] = useState<Locker | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);

  // Load transaction details when a locker is selected
  useEffect(() => {
    if (selectedLocker?.currentTransactionId) {
      // In production, fetch this from Firebase
      setTransaction(mockTransactions[selectedLocker.currentTransactionId]);
    } else {
      setTransaction(null);
    }
  }, [selectedLocker]);

  // --- Handlers ---

  const handleStatusChange = () => {
    if (!transaction) return;
  
    let nextStatus: LaundryStatus = transaction.laundryStatus;
    
    if (transaction.laundryStatus === 'Dropped') {
      nextStatus = 'Washing';
    } else if (transaction.laundryStatus === 'Washing') {
      nextStatus = 'Ready for Pick-up';
    } else if (transaction.laundryStatus === 'Ready for Pick-up') {
      nextStatus = 'Done';
    }
  
    if (nextStatus !== transaction.laundryStatus) {
      // Update local state (Replace with Firebase update in production)
      setTransaction({ ...transaction, laundryStatus: nextStatus });
      alert(`Status updated to: ${nextStatus}`);
    }
  };

  const handleResetOverdue = () => {
    if (!selectedLocker || !transaction) return;
    
    // Logic to clear the locker, archive the transaction, and free up the space
    setLockers(prev => prev.map(l => l.id === selectedLocker.id ? { ...l, currentTransactionId: undefined, isLocked: false } : l));
    setSelectedLocker(null);
    setTransaction(null);
    alert('Locker has been reset. Transaction archived as overdue.');
  };

  const toggleLock = () => {
    if (!selectedLocker) return;
    // Hardware bridge/Firebase logic goes here
    const newLockState = !selectedLocker.isLocked;
    setLockers(prev => prev.map(l => l.id === selectedLocker.id ? { ...l, isLocked: newLockState } : l));
    setSelectedLocker({ ...selectedLocker, isLocked: newLockState });
  };

  const printReceipt = () => {
    if (!transaction) return;
    // Send payload to your Python hardware bridge / printer utility
    console.log('Printing receipt for:', transaction.id);
    alert('Sending receipt to thermal printer...');
  };

  // --- Helper for Status Colors ---
  const getStatusDisplayInfo = (txn: Transaction) => {
    if (txn.laundryStatus === 'Done' && txn.reminderSent) {
      return { text: 'Overdue', colorClass: 'bg-yellow-100 text-yellow-800 border border-yellow-300' };
    }
    
    switch (txn.laundryStatus) {
      case 'Dropped':
        return { text: 'Dropped', colorClass: 'bg-red-100 text-red-800 border border-red-300' };
      case 'Washing':
        return { text: 'Washing', colorClass: 'bg-blue-100 text-blue-800 border border-blue-300' };
      case 'Ready for Pick-up':
        return { text: 'Ready for Pick-up', colorClass: 'bg-green-100 text-green-800 border border-green-300' };
      default:
        return { text: txn.laundryStatus, colorClass: 'bg-gray-100 text-gray-800 border border-gray-300' };
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 p-6 font-sans absolute inset-0 z-[100] w-full">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
          <p className="text-gray-500">Manage lockers and transactions</p>
        </div>
        <button 
          onClick={onBack} 
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors shadow-sm"
        >
          <ArrowLeft size={18} /> Exit Admin Mode
        </button>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden">
        {/* Left Panel: Locker Grid */}
        <div className="flex-1 bg-white p-6 rounded-xl shadow-md overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-gray-700">Locker Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {lockers.map((locker) => {
              const hasTransaction = !!locker.currentTransactionId;
              const isSelected = selectedLocker?.id === locker.id;

              return (
                <button
                  key={locker.id}
                  onClick={() => setSelectedLocker(locker)}
                  className={`relative p-6 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2
                    ${isSelected ? 'border-gray-800 ring-4 ring-gray-200' : 'border-gray-200 hover:border-gray-400'}
                    ${hasTransaction ? 'bg-gray-50' : 'bg-white'}
                  `}
                >
                  {/* Distinct sign for ongoing transaction */}
                  {hasTransaction && (
                    <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full animate-pulse" title="Ongoing Transaction"></span>
                  )}
                  
                  <span className="text-4xl font-black text-gray-700">{locker.lockerNumber}</span>
                  <div className="flex items-center gap-1 text-sm text-gray-500">
                    {locker.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                    {locker.isLocked ? 'Locked' : 'Unlocked'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Transaction Details & Controls */}
        <div className="w-[400px] bg-white p-6 rounded-xl shadow-md flex flex-col overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-gray-700">Locker Details</h2>
          
          {selectedLocker ? (
            <div className="flex flex-col h-full">
              <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-200">
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
                  Locker #{selectedLocker.lockerNumber}
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Status: {selectedLocker.isLocked ? <span className="text-red-600 font-medium">Secured</span> : <span className="text-green-600 font-medium">Open</span>}
                </p>

                {/* Hardware Controls */}
                <div className="flex gap-2">
                  <button 
                    onClick={toggleLock}
                    className="flex-1 bg-gray-800 text-white py-2 rounded-md hover:bg-gray-700 flex items-center justify-center gap-2 transition-colors"
                  >
                    {selectedLocker.isLocked ? <Unlock size={18} /> : <Lock size={18} />}
                    {selectedLocker.isLocked ? 'Unlock Door' : 'Lock Door'}
                  </button>
                </div>
              </div>

              {transaction ? (
                <div className="flex-1 flex flex-col">
                  <h4 className="font-bold text-gray-700 mb-3 border-b pb-2">Active Transaction</h4>
                  <div className="space-y-3 text-sm flex-1">
                    <p><span className="text-gray-500 font-medium">Txn ID:</span> <span className="font-mono">{transaction.id}</span></p>
                    <p><span className="text-gray-500 font-medium">Customer:</span> {transaction.customerName}</p>
                    <p><span className="text-gray-500 font-medium">Phone:</span> {transaction.phone}</p>
                    <p><span className="text-gray-500 font-medium">Weight:</span> {transaction.weight} kg</p>
                    <p><span className="text-gray-500 font-medium">Service:</span> {transaction.laundryType}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-gray-500 font-medium">Status:</span> 
                      {/* Dynamic Color Badge */}
                      <span className={`px-3 py-1 rounded-full font-bold text-xs uppercase tracking-wide ${getStatusDisplayInfo(transaction).colorClass}`}>
                        {getStatusDisplayInfo(transaction).text}
                      </span>
                    </div>
                  </div>

                  {/* Conditional Action Buttons based on Status */}
                  <div className="mt-6 flex flex-col gap-3">
                    
                    {/* Status Progression Logic */}
                    {transaction.laundryStatus === 'Dropped' && (
                      <button onClick={handleStatusChange} className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 font-semibold shadow-sm transition-colors">
                        Start Washing
                      </button>
                    )}
                    
                    {transaction.laundryStatus === 'Washing' && (
                      <button onClick={handleStatusChange} className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-semibold shadow-sm transition-colors">
                        Set Ready for Pick-up
                      </button>
                    )}

                    {transaction.laundryStatus === 'Ready for Pick-up' && (
                      <button onClick={handleStatusChange} className="w-full bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 font-semibold shadow-sm transition-colors">
                        Mark as Done
                      </button>
                    )}

                    {/* Overdue Reset Logic */}
                    {transaction.laundryStatus === 'Done' && transaction.reminderSent ? (
                      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-xs text-yellow-700 flex items-center gap-1 mb-2 font-medium">
                          <AlertCircle size={14} /> Item is marked Done and reminder was sent.
                        </p>
                        <button onClick={handleResetOverdue} className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 font-semibold flex items-center justify-center gap-2 transition-colors">
                          <RefreshCw size={18} /> Reset Overdue Locker
                        </button>
                      </div>
                    ) : (
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <p className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                          <Info size={14} /> Laundry is not yet set for overdue.
                        </p>
                        <button disabled className="w-full bg-gray-200 text-gray-400 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 cursor-not-allowed">
                          <RefreshCw size={18} /> Reset Overdue Locker
                        </button>
                      </div>
                    )}

                    <button onClick={printReceipt} className="w-full bg-white border-2 border-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-50 font-semibold shadow-sm transition-colors flex items-center justify-center gap-2 mt-2">
                      <Printer size={18} /> Print Receipt
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <Info size={48} className="mb-4 opacity-50" />
                  <p>No active transaction for this locker.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400">
              <p>Select a locker to view details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}