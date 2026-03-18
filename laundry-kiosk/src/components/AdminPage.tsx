import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Lock, Unlock, Printer, RefreshCw, AlertCircle, Info, ArrowLeft, Settings, Save } from 'lucide-react';
import { BackgroundBubbles } from '../components/BackgroundBubbles';
import '../styles/app.css';

type LaundryStatus = 'Dropped' | 'Washing' | 'Done' | 'Ready for Pick-up';

interface Transaction {
  id: string;
  transactionDocId: string;
  pinCode: string;
  price: number;
  weight: number;
  laundryType: string;
  laundryStatus: LaundryStatus;
  reminderSent: boolean;
}

interface Locker {
  id: string;
  lockerNumber: number;
  isLocked: boolean;
  isConnected: boolean;
  status: 'available' | 'occupied';
  currentTransactionId?: string;
}

interface AdminPageProps {
  onBack: () => void;
}

const ADMIN_PIN = '1000';
const DEFAULT_SETTINGS = {
  laundryShopName: 'Laundry Management System',
  clothesPrice: 25,
  bedSheetPrice: 50,
  minClothesPrice: 50,
  minBedSheetPrice: 50,
  overdueHours: 48,
};

export function AdminPage({ onBack }: AdminPageProps) {
  const [lockers, setLockers] = useState<Locker[]>([]);
  const [selectedLockerId, setSelectedLockerId] = useState<string | null>(null);
  const [transactionsById, setTransactionsById] = useState<Record<string, Transaction>>({});
  const [loading, setLoading] = useState(true);
  const [detailsView, setDetailsView] = useState<'locker' | 'transaction'>('locker');
  const [adminPinInput, setAdminPinInput] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [pinError, setPinError] = useState('');

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [shopName, setShopName] = useState(DEFAULT_SETTINGS.laundryShopName);
  const [prices, setPrices] = useState({
    clothesPrice: DEFAULT_SETTINGS.clothesPrice,
    bedSheetPrice: DEFAULT_SETTINGS.bedSheetPrice,
    minClothesPrice: DEFAULT_SETTINGS.minClothesPrice,
    minBedSheetPrice: DEFAULT_SETTINGS.minBedSheetPrice
  });
  const [overdueHours, setOverdueHours] = useState(DEFAULT_SETTINGS.overdueHours);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [actionError, setActionError] = useState('');

  const loadAdminOverview = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:3000/api/admin/overview');
      if (!response.ok) {
        throw new Error('Failed to load admin overview');
      }

      const data = await response.json();
      setLockers(Array.isArray(data.lockers) ? data.lockers : []);
      setTransactionsById(data.transactionsById ?? {});
      setActionError('');
    } catch (error) {
      console.error('Failed to load admin overview:', error);
      setActionError('Failed to load local admin controls.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:3000/api/settings');
      if (!response.ok) return;

      const data = await response.json();
      if (data.laundryShopName) setShopName(data.laundryShopName);
      setPrices({
        clothesPrice: data.clothesPrice ?? DEFAULT_SETTINGS.clothesPrice,
        bedSheetPrice: data.bedSheetPrice ?? DEFAULT_SETTINGS.bedSheetPrice,
        minClothesPrice: data.minClothesPrice ?? DEFAULT_SETTINGS.minClothesPrice,
        minBedSheetPrice: data.minBedSheetPrice ?? DEFAULT_SETTINGS.minBedSheetPrice,
      });
      setOverdueHours(data.overdueHours ?? DEFAULT_SETTINGS.overdueHours);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadAdminOverview();
    const intervalId = window.setInterval(() => {
      void loadAdminOverview();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [loadAdminOverview]);

  const selectedLocker = useMemo(
    () => lockers.find((locker) => locker.id === selectedLockerId) || null,
    [lockers, selectedLockerId],
  );

  const transaction = selectedLocker?.currentTransactionId
    ? transactionsById[selectedLocker.currentTransactionId] || null
    : null;

  useEffect(() => {
    setDetailsView('locker');
  }, [selectedLockerId]);

  const handleStatusChange = async () => {
    if (!transaction) return;

    let nextStatus: LaundryStatus = transaction.laundryStatus;

    if (transaction.laundryStatus === 'Dropped') nextStatus = 'Washing';
    else if (transaction.laundryStatus === 'Washing') nextStatus = 'Done';
    else if (transaction.laundryStatus === 'Ready for Pick-up') nextStatus = 'Done';

    if (nextStatus === transaction.laundryStatus) return;

    const response = await fetch('http://localhost:3000/api/admin/transaction/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: transaction.id,
        laundryStatus: nextStatus,
      }),
    });

    if (!response.ok) {
      setActionError('Failed to update the local laundry status.');
      return;
    }

    const data = await response.json();
    setLockers(data.overview?.lockers ?? []);
    setTransactionsById(data.overview?.transactionsById ?? {});
    setActionError('');
  };

  const handleResetOverdue = async () => {
    if (!selectedLocker || !transaction) return;

    const response = await fetch('http://localhost:3000/api/admin/transaction/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lockerId: selectedLocker.id,
        transactionId: transaction.id,
      }),
    });

    if (!response.ok) {
      setActionError('Failed to reset the local overdue transaction.');
      return;
    }

    const data = await response.json();
    setLockers(data.overview?.lockers ?? []);
    setTransactionsById(data.overview?.transactionsById ?? {});
    setActionError('');

    setSelectedLockerId(null);
  };

  const toggleLock = async () => {
    if (!selectedLocker) return;

    const endpoint = selectedLocker.isLocked ? 'unlock' : 'lock';
    const response = await fetch(`http://localhost:3000/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockerId: selectedLocker.id }),
    });

    if (!response.ok) {
      setActionError('Failed to update the local door control.');
      return;
    }

    setActionError('');
    void loadAdminOverview();
  };

  const printReceipt = async () => {
    if (!transaction) return;

    const response = await fetch('http://localhost:3000/api/admin/transaction/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: transaction.id }),
    });

    if (!response.ok) {
      setActionError('Failed to print the local receipt.');
      return;
    }

    setActionError('');
  };

  const handleAdminPinSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (adminPinInput === ADMIN_PIN) {
      setIsAdminAuthenticated(true);
      setPinError('');
      return;
    }

    setPinError('Invalid admin PIN.');
    setAdminPinInput('');
  };

  const handlePinDigitPress = (digit: string) => {
    if (adminPinInput.length >= 4) return;
    setAdminPinInput((prev) => `${prev}${digit}`);
    if (pinError) setPinError('');
  };

  const handlePinDelete = () => {
    setAdminPinInput((prev) => prev.slice(0, -1));
    if (pinError) setPinError('');
  };

  const handlePinClear = () => {
    setAdminPinInput('');
    if (pinError) setPinError('');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:3000/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          laundryShopName: shopName,
          overdueHours,
          ...prices
        })
      });
      if (res.ok) {
        setSaveStatus('success');
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
    }
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const handleOpenSettings = () => {
    setIsSettingsOpen(true);
    void loadSettings();
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPrices(prev => ({ ...prev, [name]: Number(value) }));
  };


  const overdueHourOptions = [24, 48, 72, 96, 120].map((hours) => ({
    value: hours,
    label: `${hours} hours${hours === 48 ? ' (recommended)' : ''}`,
  }));

  const getStatusDisplayInfo = (txn: Transaction) => {
    if ((txn.laundryStatus === 'Done' || txn.laundryStatus === 'Ready for Pick-up') && txn.reminderSent) {
      return { text: 'Overdue', colorClass: 'bg-yellow-100 text-yellow-800 border border-yellow-300' };
    }

    switch (txn.laundryStatus) {
      case 'Dropped':
        return { text: 'Dropped', colorClass: 'bg-red-100 text-red-800 border border-red-300' };
      case 'Washing':
        return { text: 'Washing', colorClass: 'bg-blue-100 text-blue-800 border border-blue-300' };
      case 'Done':
      case 'Ready for Pick-up':
        return { text: 'Ready for Pick-up', colorClass: 'bg-green-100 text-green-800 border border-green-300' };
      default:
        return { text: txn.laundryStatus, colorClass: 'bg-gray-100 text-gray-800 border border-gray-300' };
    }
  };

  if (!isAdminAuthenticated) {
    return (
      <div
        className="lockers-page"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '12px',
          backgroundColor: '#f9fafb',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <BackgroundBubbles variant="tinted" />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <button onClick={onBack} className="btn-return-absolute" style={{ zIndex: 10 }}>
            <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
            Return
          </button>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <form
              onSubmit={handleAdminPinSubmit}
              style={{
                width: '100%',
                maxWidth: '360px',
                backgroundColor: 'white',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <h2 style={{ margin: 0, color: '#111827' }}>Admin Security Check</h2>
              <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>Enter admin PIN to access dashboard.</p>
              <input
                type="password"
                value={adminPinInput}
                readOnly
                placeholder="Enter PIN"
                style={{
                  border: '1px solid #dbe5f1',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '20px',
                  letterSpacing: '6px',
                  textAlign: 'center',
                  backgroundColor: '#f8fbff',
                  color: '#1f2937',
                }}
              />
              {pinError && <p style={{ margin: 0, color: '#dc2626', fontSize: '14px', textAlign: 'center' }}>{pinError}</p>}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: '8px',
                }}
              >
                {[...'123456789'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => handlePinDigitPress(digit)}
                    style={{
                      border: '1px solid #dbe5f1',
                      borderRadius: '8px',
                      backgroundColor: '#f8fbff',
                      color: '#1f2937',
                      padding: '10px',
                      fontWeight: 700,
                      fontSize: '18px',
                    }}
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handlePinClear}
                  style={{
                    border: '1px solid #f3d6d6',
                    borderRadius: '8px',
                    backgroundColor: '#fff5f5',
                    color: '#b91c1c',
                    padding: '10px',
                    fontWeight: 600,
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handlePinDigitPress('0')}
                  style={{
                    border: '1px solid #dbe5f1',
                    borderRadius: '8px',
                    backgroundColor: '#f8fbff',
                    color: '#1f2937',
                    padding: '10px',
                    fontWeight: 700,
                    fontSize: '18px',
                  }}
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handlePinDelete}
                  style={{
                    border: '1px solid #dbe5f1',
                    borderRadius: '8px',
                    backgroundColor: '#eef4ff',
                    color: '#1e3a8a',
                    padding: '10px',
                    fontWeight: 600,
                  }}
                >
                  Delete
                </button>
              </div>

              <button
                type="submit"
                style={{
                  border: 'none',
                  borderRadius: '8px',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  padding: '10px',
                  fontWeight: 600,
                }}
              >
                Unlock Admin Page
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="lockers-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '12px',
        backgroundColor: '#f9fafb',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <BackgroundBubbles variant="tinted" />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        
        <button 
          onClick={() => isSettingsOpen ? setIsSettingsOpen(false) : onBack()} 
          className="btn-return-absolute" 
          style={{ zIndex: 10 }}
        >
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

        {/* Settings Button (Top Right) */}
        {!isSettingsOpen && (
          <button
            onClick={() => {
              void handleOpenSettings();
            }}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              zIndex: 10,
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              color: '#374151',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              transition: 'background-color 0.2s ease',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'white')}
          >
            <Settings size={18} color="#4b5563" /> Settings
          </button>
        )}

        {isSettingsOpen ? (
          /* --- SETTINGS PAGE VIEW --- */
          <>
            <div className="available-lockers-container" style={{ marginTop: '12px', marginBottom: '10px' }}>
              <div className="instructions-header" style={{ marginBottom: '8px', textAlign: 'center' }}>
                <h2 style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  Admin Settings
                </h2>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
                  Update pricing, overdue reminders, and name of the laundry shop.
                </p>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minHeight: 0, overflow: 'hidden' }}>
              <form 
                onSubmit={handleSaveSettings}
                style={{
                  width: '100%',
                  maxWidth: '980px',
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  minHeight: 0,
                  colorScheme: 'light'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>Laundry Shop Name</label>
                  <input 
                    type="text" 
                    value={shopName} 
                    onChange={(e) => setShopName(e.target.value)}
                    inputMode="text"
                    autoComplete="off"
                    onTouchStart={(e) => e.currentTarget.focus()}
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb', fontSize: '16px', color: '#000000', colorScheme: 'light' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                  {/* Clothes Pricing */}
                  <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                    <h3 style={{ fontSize: '16px', margin: '0 0 12px 0', color: '#1f2937' }}>Clothes Pricing</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563', display: 'block', marginBottom: '4px' }}>Price per kg (₱)</label>
                        <input 
                          type="number" 
                          name="clothesPrice" 
                          value={prices.clothesPrice} 
                          onChange={handlePriceChange}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb', color: '#000000', boxSizing: 'border-box', colorScheme: 'light' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563', display: 'block', marginBottom: '4px' }}>Minimum Total Price (₱)</label>
                        <input 
                          type="number" 
                          name="minClothesPrice" 
                          value={prices.minClothesPrice} 
                          onChange={handlePriceChange}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb', color: '#000000', boxSizing: 'border-box', colorScheme: 'light' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bed Sheets Pricing */}
                  <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                    <h3 style={{ fontSize: '16px', margin: '0 0 12px 0', color: '#1f2937' }}>Bed Sheets Pricing</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563', display: 'block', marginBottom: '4px' }}>Price per kg (₱)</label>
                        <input 
                          type="number" 
                          name="bedSheetPrice" 
                          value={prices.bedSheetPrice} 
                          onChange={handlePriceChange}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb', color: '#000000', boxSizing: 'border-box', colorScheme: 'light' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563', display: 'block', marginBottom: '4px' }}>Minimum Total Price (₱)</label>
                        <input 
                          type="number" 
                          name="minBedSheetPrice" 
                          value={prices.minBedSheetPrice} 
                          onChange={handlePriceChange}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb', color: '#000000', boxSizing: 'border-box', colorScheme: 'light' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>


                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>Overdue Reminder Window</label>
                  <select
                    value={String(overdueHours)}
                    onChange={(e) => setOverdueHours(Number(e.target.value))}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      fontSize: '16px',
                      backgroundColor: '#f9fafb',
                      color: '#000000',
                      colorScheme: 'light'
                    }}
                  >
                    {overdueHourOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
                    Laundry marked as done beyond this selected time will be considered overdue.
                  </p>
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <button
                    type="submit"
                    style={{
                      backgroundColor: '#2563eb',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '12px 24px',
                      fontSize: '16px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Save size={18} /> Save Settings
                  </button>
                  {saveStatus === 'success' && <span style={{ color: '#059669', fontWeight: 600, fontSize: '14px' }}>✓ Settings saved successfully</span>}
                  {saveStatus === 'error' && <span style={{ color: '#dc2626', fontWeight: 600, fontSize: '14px' }}>✗ Failed to save. Check server connection.</span>}
                </div>
              </form>
            </div>
          </>
        ) : (
          /* --- MAIN DASHBOARD VIEW --- */
          <>
            <div className="available-lockers-container" style={{ marginTop: '12px', marginBottom: '10px' }}>
              <div className="instructions-header" style={{ marginBottom: '8px' }}>
                <h2 style={{ margin: '0 0 4px 0' }}>Admin Dashboard</h2>
                <p style={{ margin: '0' }}>Manage lockers and transactions locally on this kiosk.</p>
              </div>
            </div>

            {actionError && (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #fecaca',
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                {actionError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px', flex: 1, minHeight: 0 }}>
              <div
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <h3 style={{ fontSize: '18px', color: '#1f2937', marginBottom: '8px' }}>Locker Overview</h3>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {loading ? (
                    <p style={{ color: '#6b7280' }}>Loading lockers…</p>
                  ) : (
                    <div
                      className="lockers-grid-container"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))',
                        gap: '10px',
                      }}
                    >
                      {lockers.map((locker) => {
                        const isSelected = selectedLocker?.id === locker.id;
                        const isOccupied = locker.status === 'occupied';

                        return (
                          <button
                            key={locker.id}
                            onClick={() => setSelectedLockerId(locker.id)}
                            style={{
                              backgroundColor: isSelected ? '#dbeafe' : isOccupied ? '#fef2f2' : '#ecfdf5',
                              border: isSelected
                                ? '2px solid #3b82f6'
                                : isOccupied
                                  ? '2px solid #fecaca'
                                  : '2px solid #a7f3d0',
                              borderRadius: '12px',
                              padding: '10px',
                              height: '108px',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'center',
                              alignItems: 'center',
                              gap: '4px',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              position: 'relative',
                            }}
                          >
                            {locker.currentTransactionId && (
                              <span
                                style={{
                                  position: 'absolute',
                                  top: 8,
                                  right: 8,
                                  height: 8,
                                  width: 8,
                                  backgroundColor: '#ef4444',
                                  borderRadius: 999,
                                }}
                                title="Ongoing Transaction"
                              />
                            )}
                            <span style={{ fontSize: '20px', fontWeight: 700, color: '#374151' }}>Locker {locker.lockerNumber}</span>
                            <span style={{ fontSize: '12px', color: locker.isLocked ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                              {locker.isLocked ? 'Locked' : 'Unlocked'}
                            </span>
                            <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase' }}>{locker.status}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <h3 style={{ fontSize: '18px', color: '#1f2937', marginBottom: '8px' }}>
                  {selectedLocker && detailsView === 'transaction' ? 'Transaction Details' : 'Locker Details'}
                </h3>

                {!selectedLocker ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                    <p>Select a locker to view details.</p>
                  </div>
                ) : (
                  <>
                    {detailsView === 'locker' && (
                      <div
                        style={{
                          backgroundColor: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '10px',
                          padding: '10px',
                          marginBottom: '10px',
                        }}
                      >
                        <p style={{ fontSize: '16px', fontWeight: 700, color: '#1f2937', marginBottom: '4px' }}>
                          Locker #{selectedLocker.lockerNumber}
                        </p>
                        <p style={{ fontSize: '13px', color: '#4b5563', marginBottom: '8px' }}>
                          Status:{' '}
                          <span style={{ fontWeight: 600, color: selectedLocker.isLocked ? '#ef4444' : '#10b981' }}>
                            {selectedLocker.isLocked ? 'Secured' : 'Open'}
                          </span>
                        </p>
                        <button
                          onClick={toggleLock}
                          style={{
                            width: '100%',
                            backgroundColor: '#1f2937',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '8px 10px',
                            fontSize: '14px',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          {selectedLocker.isLocked ? <Unlock size={16} /> : <Lock size={16} />}
                          {selectedLocker.isLocked ? 'Unlock Door' : 'Lock Door'}
                        </button>
                      </div>
                    )}

                    {transaction && detailsView === 'locker' && (
                      <button
                        onClick={() => setDetailsView('transaction')}
                        style={{
                          width: '100%',
                          border: '1px solid #d1d5db',
                          borderRadius: '8px',
                          backgroundColor: '#f8fafc',
                          color: '#1f2937',
                          padding: '10px',
                          fontWeight: 600,
                          marginBottom: '10px',
                        }}
                      >
                        View Transaction Details
                      </button>
                    )}

                    {detailsView === 'locker' ? (
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#9ca3af',
                          gap: '8px',
                        }}
                      >
                        {transaction ? (
                          <p style={{ fontSize: '14px', color: '#6b7280' }}>Tap the button above to view transaction details.</p>
                        ) : (
                          <>
                            <AlertCircle size={28} />
                            <p style={{ fontSize: '14px' }}>No active transaction for this locker.</p>
                          </>
                        )}
                      </div>
                    ) : transaction ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <button
                          onClick={() => setDetailsView('locker')}
                          style={{
                            alignSelf: 'flex-start',
                            border: '1px solid #d1d5db',
                            borderRadius: '8px',
                            backgroundColor: 'white',
                            color: '#374151',
                            padding: '6px 10px',
                            fontSize: '12px',
                            fontWeight: 600,
                            marginBottom: '8px',
                          }}
                        >
                          ← Back to Locker Details
                        </button>

                        <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.7, marginBottom: '8px' }}>
                          <p><strong>TRN-ID:</strong> {transaction.id}</p>
                          <p><strong>Pin Code:</strong> {transaction.pinCode}</p>
                          <p><strong>Weight:</strong> {transaction.weight} kg</p>
                          <p><strong>Price:</strong> ₱{transaction.price.toFixed(2)}</p>
                          <p><strong>Type:</strong> {transaction.laundryType}</p>
                          <p>
                            <strong>Status:</strong>{' '}
                            <span className={`px-2 py-1 rounded-full text-xs ${getStatusDisplayInfo(transaction).colorClass}`}>
                              {getStatusDisplayInfo(transaction).text}
                            </span>
                          </p>
                        </div>

                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {transaction.laundryStatus === 'Dropped' && (
                            <button
                              onClick={handleStatusChange}
                              style={{
                                width: '100%',
                                border: 'none',
                                borderRadius: '8px',
                                backgroundColor: '#2563eb',
                                color: 'white',
                                padding: '10px',
                                fontWeight: 600,
                              }}
                            >
                              Start Washing
                            </button>
                          )}

                          {transaction.laundryStatus === 'Washing' && (
                            <button
                              onClick={handleStatusChange}
                              style={{
                                width: '100%',
                                border: 'none',
                                borderRadius: '8px',
                                backgroundColor: '#059669',
                                color: 'white',
                                padding: '10px',
                                fontWeight: 600,
                              }}
                            >
                              Set Ready for Pick-up
                            </button>
                          )}

                          {(transaction.laundryStatus === 'Done' || transaction.laundryStatus === 'Ready for Pick-up') &&
                          transaction.reminderSent ? (
                            <button
                              onClick={handleResetOverdue}
                              style={{
                                width: '100%',
                                border: 'none',
                                borderRadius: '8px',
                                backgroundColor: '#dc2626',
                                color: 'white',
                                padding: '10px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                              }}
                            >
                              <RefreshCw size={16} /> Reset Overdue Locker
                            </button>
                          ) : transaction.laundryStatus === 'Done' ? (
                            <div
                              style={{
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                backgroundColor: '#f9fafb',
                                color: '#6b7280',
                                fontSize: '12px',
                                padding: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <Info size={14} /> Laundry is not yet set for overdue.
                            </div>
                          ) : null}

                          <button
                            onClick={printReceipt}
                            style={{
                              width: '100%',
                              border: '2px solid #d1d5db',
                              borderRadius: '8px',
                              backgroundColor: 'white',
                              color: '#374151',
                              padding: '10px',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                            }}
                          >
                            <Printer size={16} /> Print Receipt
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#9ca3af',
                          gap: '8px',
                        }}
                      >
                        <AlertCircle size={28} />
                        <p style={{ fontSize: '14px' }}>No active transaction for this locker.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
