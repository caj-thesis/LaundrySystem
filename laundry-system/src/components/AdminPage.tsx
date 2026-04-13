import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Lock, Unlock, Printer, RefreshCw, AlertCircle, Info, ArrowLeft, ArrowUp, ArrowDown, X, Settings, Save, LayoutDashboard, History, BarChart3, Search, Filter } from 'lucide-react';
import { BackgroundBubbles } from '../components/BackgroundBubbles';
import { formatWeight, normalizeWeight } from '../utils/weight';
import '../styles/app.css';

type LaundryStatus = 'Dropped' | 'Washing' | 'Done' | 'Ready for Pick-up';
type PriceField = 'clothesPrice' | 'bedSheetPrice' | 'minClothesPrice' | 'minBedSheetPrice';
type SettingsField = 'shopName' | PriceField;
type KeyboardMode = 'text' | 'number';
type AdminView = 'dashboard' | 'history' | 'sales' | 'settings';

interface Transaction {
  id: string;
  transactionDocId: string;
  pinCode: string;
  price: number;
  weight: number;
  laundryType: string;
  laundryStatus: LaundryStatus;
  reminderSent: boolean;
  status: 'Pending' | 'Completed' | 'Archived';
  lockerId: number | null;
  archivedFromLockerId: number | null;
  phoneNumber: string;
  paymentId: string;
  droppedAt: string | null;
  doneAt: string | null;
  pickedUpAt: string | null;
  note: string;
  updatedAt: string | null;
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

interface TransactionHistoryFilters {
  search: string;
  status: string;
  laundryStatus: string;
  type: string;
  lockerId: string;
  startDate: string;
  endDate: string;
}

interface SalesRange {
  startDate: string;
  endDate: string;
}

interface SalesSummary {
  totalSales: number;
  totalTransactions: number;
  totalWeight: number;
  averageSale: number;
}

interface SalesByType {
  type: string;
  totalSales: number;
  totalTransactions: number;
  totalWeight: number;
}

interface DailySales {
  date: string;
  totalSales: number;
  totalTransactions: number;
}

interface SalesData {
  summary: SalesSummary;
  byType: SalesByType[];
  dailySales: DailySales[];
  transactions: Transaction[];
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

const TEXT_KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const HISTORY_SEARCH_KEYBOARD_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ...TEXT_KEYBOARD_ROWS,
];

const NUMBER_KEYBOARD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['0'],
];

function getTextKeyboardRows(isUppercase: boolean) {
  return TEXT_KEYBOARD_ROWS.map((row) => row.map((key) => (isUppercase ? key : key.toLowerCase())));
}

function getHistorySearchKeyboardRows(isUppercase: boolean) {
  return [
    HISTORY_SEARCH_KEYBOARD_ROWS[0],
    ...getTextKeyboardRows(isUppercase),
  ];
}

const SETTINGS_FIELD_LABELS: Record<SettingsField, string> = {
  shopName: 'Laundry Shop Name',
  clothesPrice: 'Clothes Price Per Kg',
  minClothesPrice: 'Clothes Minimum Total Price',
  bedSheetPrice: 'Bed Sheets Price Per Kg',
  minBedSheetPrice: 'Bed Sheets Minimum Total Price',
};

const HISTORY_FILTER_DEFAULTS: TransactionHistoryFilters = {
  search: '',
  status: 'all',
  laundryStatus: 'all',
  type: 'all',
  lockerId: 'all',
  startDate: '',
  endDate: '',
};

const EMPTY_SALES_DATA: SalesData = {
  summary: {
    totalSales: 0,
    totalTransactions: 0,
    totalWeight: 0,
    averageSale: 0,
  },
  byType: [],
  dailySales: [],
  transactions: [],
};

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function createDefaultSalesRange(): SalesRange {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 6);

  return {
    startDate: toDateInputValue(startDate),
    endDate: toDateInputValue(endDate),
  };
}

function formatCurrency(value: number) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

function mapTransactionRecord(raw: any): Transaction {
  return {
    id: String(raw.id ?? raw.transactionId ?? raw.transactionDocId ?? ''),
    transactionDocId: String(raw.transactionDocId ?? raw.transactionId ?? raw.id ?? ''),
    pinCode: String(raw.pinCode ?? raw.pin ?? '0000'),
    price: Number(raw.price || 0),
    weight: normalizeWeight(raw.weight),
    laundryType: String(raw.laundryType ?? raw.type ?? 'Clothes'),
    laundryStatus: (raw.laundryStatus ?? 'Dropped') as LaundryStatus,
    reminderSent: Boolean(raw.reminderSent),
    status: (raw.status ?? 'Pending') as Transaction['status'],
    lockerId: raw.lockerId !== null && raw.lockerId !== undefined ? Number(raw.lockerId) : null,
    archivedFromLockerId: raw.archivedFromLockerId !== null && raw.archivedFromLockerId !== undefined
      ? Number(raw.archivedFromLockerId)
      : null,
    phoneNumber: String(raw.phoneNumber ?? ''),
    paymentId: String(raw.paymentId ?? ''),
    droppedAt: raw.droppedAt ?? null,
    doneAt: raw.doneAt ?? null,
    pickedUpAt: raw.pickedUpAt ?? null,
    note: String(raw.note ?? ''),
    updatedAt: raw.updatedAt ?? null,
  };
}

export function AdminPage({ onBack }: AdminPageProps) {
  const defaultSalesRange = useMemo(() => createDefaultSalesRange(), []);
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
  const [activeSettingsField, setActiveSettingsField] = useState<SettingsField | null>(null);
  const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>('text');
  const [isSettingsKeyboardUppercase, setIsSettingsKeyboardUppercase] = useState(true);
  const [adminView, setAdminView] = useState<AdminView>('dashboard');
  const [historyFilters, setHistoryFilters] = useState<TransactionHistoryFilters>(HISTORY_FILTER_DEFAULTS);
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState<TransactionHistoryFilters>(HISTORY_FILTER_DEFAULTS);
  const [historyTransactions, setHistoryTransactions] = useState<Transaction[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [isHistoryFiltersOpen, setIsHistoryFiltersOpen] = useState(false);
  const [isHistorySearchKeyboardOpen, setIsHistorySearchKeyboardOpen] = useState(false);
  const [isHistorySearchKeyboardUppercase, setIsHistorySearchKeyboardUppercase] = useState(true);
  const [overdueTransactions, setOverdueTransactions] = useState<Transaction[]>([]);
  const [isOverdueTransactionsOpen, setIsOverdueTransactionsOpen] = useState(false);
  const [settlingOverdueTransactionId, setSettlingOverdueTransactionId] = useState<string | null>(null);
  const [salesRange, setSalesRange] = useState<SalesRange>(defaultSalesRange);
  const [appliedSalesRange, setAppliedSalesRange] = useState<SalesRange>(defaultSalesRange);
  const [salesData, setSalesData] = useState<SalesData>(EMPTY_SALES_DATA);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [isSalesFiltersOpen, setIsSalesFiltersOpen] = useState(false);

  const loadAdminOverview = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:3000/api/admin/overview');
      if (!response.ok) {
        throw new Error('Failed to load admin overview');
      }

      const data = await response.json();
      setLockers(Array.isArray(data.lockers) ? data.lockers : []);
      const nextTransactionsById: Record<string, Transaction> = {};
      for (const raw of Object.values(data.transactionsById ?? {})) {
        const transaction = mapTransactionRecord(raw);
        if (transaction.id) {
          nextTransactionsById[transaction.id] = transaction;
        }
      }
      setTransactionsById(nextTransactionsById);
      setOverdueTransactions(Array.isArray(data.overdueTransactions) ? data.overdueTransactions.map(mapTransactionRecord) : []);
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

  const loadTransactionHistory = useCallback(async (filters: TransactionHistoryFilters) => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const params = new URLSearchParams();

      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== 'all') {
          params.set(key, value);
        }
      });

      const response = await fetch(`http://localhost:3000/api/admin/transactions?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to load transaction history');
      }

      const data = await response.json();
      setHistoryTransactions(Array.isArray(data.transactions) ? data.transactions.map(mapTransactionRecord) : []);
      setHistoryTotal(Number(data.total || 0));
    } catch (error) {
      console.error('Failed to load transaction history:', error);
      setHistoryTransactions([]);
      setHistoryTotal(0);
      setHistoryError('Failed to load transaction history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadSalesData = useCallback(async (range: SalesRange) => {
    setSalesLoading(true);
    setSalesError('');

    try {
      const params = new URLSearchParams();
      if (range.startDate) params.set('startDate', range.startDate);
      if (range.endDate) params.set('endDate', range.endDate);

      const response = await fetch(`http://localhost:3000/api/admin/sales?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to load sales data');
      }

      const data = await response.json();
      setSalesData({
        summary: {
          totalSales: Number(data.summary?.totalSales || 0),
          totalTransactions: Number(data.summary?.totalTransactions || 0),
          totalWeight: normalizeWeight(data.summary?.totalWeight),
          averageSale: Number(data.summary?.averageSale || 0),
        },
        byType: Array.isArray(data.byType) ? data.byType.map((row: any) => ({
          type: String(row.type || 'Unknown'),
          totalSales: Number(row.totalSales || 0),
          totalTransactions: Number(row.totalTransactions || 0),
          totalWeight: normalizeWeight(row.totalWeight),
        })) : [],
        dailySales: Array.isArray(data.dailySales) ? data.dailySales.map((row: any) => ({
          date: String(row.date || ''),
          totalSales: Number(row.totalSales || 0),
          totalTransactions: Number(row.totalTransactions || 0),
        })) : [],
        transactions: Array.isArray(data.transactions) ? data.transactions.map(mapTransactionRecord) : [],
      });
    } catch (error) {
      console.error('Failed to load sales data:', error);
      setSalesData(EMPTY_SALES_DATA);
      setSalesError('Failed to load sales summary.');
    } finally {
      setSalesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!isAdminAuthenticated || isSettingsOpen || adminView !== 'dashboard') {
      return;
    }

    setLoading(true);
    void loadAdminOverview();
    const intervalId = window.setInterval(() => {
      void loadAdminOverview();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [adminView, isAdminAuthenticated, isSettingsOpen, loadAdminOverview]);

  useEffect(() => {
    if (!isAdminAuthenticated || isSettingsOpen || adminView !== 'history') {
      return;
    }

    void loadTransactionHistory(appliedHistoryFilters);
  }, [adminView, appliedHistoryFilters, isAdminAuthenticated, isSettingsOpen, loadTransactionHistory]);

  useEffect(() => {
    if (!isAdminAuthenticated || isSettingsOpen || adminView !== 'sales') {
      return;
    }

    void loadSalesData(appliedSalesRange);
  }, [adminView, appliedSalesRange, isAdminAuthenticated, isSettingsOpen, loadSalesData]);

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

  const handleMarkOverdueAsPaid = async (transactionId: string) => {
    setSettlingOverdueTransactionId(transactionId);

    try {
      const response = await fetch('http://localhost:3000/api/admin/transaction/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to mark overdue transaction as paid.');
      }

      const data = await response.json();
      setLockers(Array.isArray(data.overview?.lockers) ? data.overview.lockers : []);

      const nextTransactionsById: Record<string, Transaction> = {};
      for (const raw of Object.values(data.overview?.transactionsById ?? {})) {
        const nextTransaction = mapTransactionRecord(raw);
        if (nextTransaction.id) {
          nextTransactionsById[nextTransaction.id] = nextTransaction;
        }
      }
      setTransactionsById(nextTransactionsById);
      setOverdueTransactions(Array.isArray(data.overview?.overdueTransactions) ? data.overview.overdueTransactions.map(mapTransactionRecord) : []);
      setActionError('');
    } catch (error) {
      console.error('Failed to mark overdue transaction as paid:', error);
      setActionError('Failed to mark overdue transaction as paid.');
    } finally {
      setSettlingOverdueTransactionId(null);
    }
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
    setActiveSettingsField(null);
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
    setAdminView('settings');
    setActiveSettingsField(null);
    setIsSettingsKeyboardUppercase(true);
    setIsOverdueTransactionsOpen(false);
    setIsHistoryFiltersOpen(false);
    setIsHistorySearchKeyboardOpen(false);
    setIsHistorySearchKeyboardUppercase(true);
    setIsSalesFiltersOpen(false);
    void loadSettings();
  };

  const closeHistoryFilters = () => {
    setIsHistoryFiltersOpen(false);
    setIsHistorySearchKeyboardOpen(false);
    setIsHistorySearchKeyboardUppercase(true);
  };

  const handleHistorySearchFocus = () => {
    setIsHistoryFiltersOpen(true);
    setIsHistorySearchKeyboardOpen(true);
    setIsHistorySearchKeyboardUppercase(true);
  };

  const handleHistorySearchCharacter = (character: string) => {
    setHistoryFilters((prev) => ({ ...prev, search: `${prev.search}${character}` }));
  };

  const handleHistorySearchBackspace = () => {
    setHistoryFilters((prev) => ({ ...prev, search: prev.search.slice(0, -1) }));
  };

  const handleHistorySearchClear = () => {
    setHistoryFilters((prev) => ({ ...prev, search: '' }));
  };

  const updatePriceField = (field: PriceField, nextValue: number) => {
    setPrices((prev) => ({ ...prev, [field]: nextValue }));
  };

  const handleSettingsFieldFocus = (field: SettingsField, mode: KeyboardMode) => {
    setActiveSettingsField(field);
    setKeyboardMode(mode);
    if (mode === 'text') {
      setIsSettingsKeyboardUppercase(true);
    }
    setSaveStatus('idle');
  };

  const handleKeyboardCharacter = (character: string) => {
    if (!activeSettingsField) return;

    if (activeSettingsField === 'shopName') {
      setShopName((prev) => `${prev}${character}`);
      return;
    }

    const currentValue = String(prices[activeSettingsField]);
    if (character === '.' && currentValue.includes('.')) return;

    const nextValue = currentValue === '0' && character !== '.'
      ? character
      : `${currentValue}${character}`;

    const parsed = Number(nextValue);
    if (!Number.isNaN(parsed)) {
      updatePriceField(activeSettingsField, parsed);
    }
  };

  const handleKeyboardBackspace = () => {
    if (!activeSettingsField) return;

    if (activeSettingsField === 'shopName') {
      setShopName((prev) => prev.slice(0, -1));
      return;
    }

    const currentValue = String(prices[activeSettingsField]);
    const nextRawValue = currentValue.slice(0, -1);

    if (!nextRawValue || nextRawValue === '-') {
      updatePriceField(activeSettingsField, 0);
      return;
    }

    const sanitizedValue = nextRawValue.endsWith('.') ? nextRawValue.slice(0, -1) : nextRawValue;
    const parsed = Number(sanitizedValue);
    updatePriceField(activeSettingsField, Number.isNaN(parsed) ? 0 : parsed);
  };

  const handleKeyboardClear = () => {
    if (!activeSettingsField) return;

    if (activeSettingsField === 'shopName') {
      setShopName('');
      return;
    }

    updatePriceField(activeSettingsField, 0);
  };

  const getActiveSettingsFieldValue = () => {
    if (!activeSettingsField) return '';
    if (activeSettingsField === 'shopName') return shopName;
    return String(prices[activeSettingsField]);
  };

  const renderSettingsKeyboardOverlay = () => {
    if (!activeSettingsField) return null;

    const rows = keyboardMode === 'text'
      ? getTextKeyboardRows(isSettingsKeyboardUppercase)
      : NUMBER_KEYBOARD_ROWS;
    const currentValue = getActiveSettingsFieldValue();

    return (
      <div
        style={{
          position: 'absolute',
          inset: '76px 16px 16px',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px',
        }}
      >
        <button
          type="button"
          aria-label="Close editor"
          onClick={() => setActiveSettingsField(null)}
          style={{
            position: 'absolute',
            inset: 0,
            border: 'none',
            backgroundColor: 'rgba(241,245,249,0.82)',
            backdropFilter: 'blur(2px)',
            cursor: 'pointer',
          }}
        />

        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '880px',
            maxHeight: '100%',
            backgroundColor: '#ffffff',
            border: '1px solid #dbe5f1',
            borderRadius: '18px',
            padding: '16px',
            boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748b' }}>
                Field Editor
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{SETTINGS_FIELD_LABELS[activeSettingsField]}</span>
            </div>
            <button
              type="button"
              onClick={() => setActiveSettingsField(null)}
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '999px',
                backgroundColor: 'white',
                color: '#374151',
                width: '40px',
                height: '40px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Close field editor"
              title="Close"
            >
              <X size={18} strokeWidth={2.4} />
            </button>
          </div>

          <div
            style={{
              backgroundColor: '#f8fbff',
              border: '1px solid #dbe5f1',
              borderRadius: '14px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Current Value
            </span>
            <div
              style={{
                minHeight: keyboardMode === 'text' ? '76px' : '64px',
                borderRadius: '12px',
                border: '2px solid #bfdbfe',
                backgroundColor: 'white',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                color: '#0f172a',
                fontSize: keyboardMode === 'text' ? '24px' : '28px',
                fontWeight: 700,
                letterSpacing: keyboardMode === 'text' ? 'normal' : '0.03em',
                wordBreak: 'break-word',
              }}
            >
              {currentValue || <span style={{ color: '#94a3b8', fontWeight: 500 }}>Enter value...</span>}
            </div>
          </div>

          <div
            style={{
              width: '100%',
              backgroundColor: '#ffffff',
              border: '1px solid #dbe5f1',
              borderRadius: '14px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                flexWrap: 'wrap',
                backgroundColor: '#f8fbff',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '8px 10px',
                color: '#1f2937',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                On-screen Keyboard
              </span>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{SETTINGS_FIELD_LABELS[activeSettingsField]}</span>
            </div>

            {rows.map((row, rowIndex) => (
              <div
                key={`${keyboardMode}-${rowIndex}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                  gap: '6px',
                }}
              >
                {row.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleKeyboardCharacter(key)}
                    style={{
                      border: '1px solid #dbe5f1',
                      borderRadius: '10px',
                      backgroundColor: '#f8fafc',
                      color: '#0f172a',
                      padding: keyboardMode === 'text' ? '10px 0' : '12px 0',
                      fontSize: keyboardMode === 'text' ? '15px' : '18px',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '6px',
              }}
            >
              {keyboardMode === 'text' && (
                <button
                  type="button"
                  onClick={() => setIsSettingsKeyboardUppercase((prev) => !prev)}
                  style={{
                    border: `1px solid ${isSettingsKeyboardUppercase ? '#93c5fd' : '#dbe5f1'}`,
                    borderRadius: '10px',
                    backgroundColor: isSettingsKeyboardUppercase ? '#dbeafe' : '#f8fafc',
                    color: isSettingsKeyboardUppercase ? '#1d4ed8' : '#334155',
                    padding: '10px 0',
                    fontSize: '14px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  aria-label={isSettingsKeyboardUppercase ? 'Switch to lowercase' : 'Switch to uppercase'}
                  title={isSettingsKeyboardUppercase ? 'Switch to lowercase' : 'Switch to uppercase'}
                >
                  {isSettingsKeyboardUppercase ? <ArrowDown size={16} strokeWidth={2.4} /> : <ArrowUp size={16} strokeWidth={2.4} />}
                  <span>{isSettingsKeyboardUppercase ? 'a' : 'A'}</span>
                </button>
              )}
              {keyboardMode === 'text' && (
                <button
                  type="button"
                  onClick={() => handleKeyboardCharacter(' ')}
                  style={{
                    border: '1px solid #bfdbfe',
                    borderRadius: '10px',
                    backgroundColor: '#eff6ff',
                    color: '#1e3a8a',
                    padding: '10px 0',
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                >
                  Space
                </button>
              )}
              <button
                type="button"
                onClick={handleKeyboardBackspace}
                style={{
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  backgroundColor: '#fff1f2',
                  color: '#991b1b',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Backspace
              </button>
              <button
                type="button"
                onClick={handleKeyboardClear}
                style={{
                  border: '1px solid #fcd34d',
                  borderRadius: '10px',
                  backgroundColor: '#fffbeb',
                  color: '#92400e',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsField(null)}
                style={{
                  border: '1px solid #86efac',
                  borderRadius: '10px',
                  backgroundColor: '#f0fdf4',
                  color: '#166534',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderHistorySearchKeyboardOverlay = () => {
    if (!isHistoryFiltersOpen || !isHistorySearchKeyboardOpen) return null;

    const rows = getHistorySearchKeyboardRows(isHistorySearchKeyboardUppercase);

    return (
      <div
        style={{
          position: 'absolute',
          inset: '76px 16px 16px',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px',
        }}
      >
        <button
          type="button"
          aria-label="Close search editor"
          onClick={() => setIsHistorySearchKeyboardOpen(false)}
          style={{
            position: 'absolute',
            inset: 0,
            border: 'none',
            backgroundColor: 'rgba(241,245,249,0.82)',
            backdropFilter: 'blur(2px)',
            cursor: 'pointer',
          }}
        />

        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '880px',
            maxHeight: '100%',
            backgroundColor: '#ffffff',
            border: '1px solid #dbe5f1',
            borderRadius: '18px',
            padding: '16px',
            boxShadow: '0 18px 40px rgba(15,23,42,0.16)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748b' }}>
                Field Editor
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>Transaction Search</span>
            </div>
            <button
              type="button"
              onClick={() => setIsHistorySearchKeyboardOpen(false)}
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '999px',
                backgroundColor: 'white',
                color: '#374151',
                width: '40px',
                height: '40px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Close search editor"
              title="Close"
            >
              <X size={18} strokeWidth={2.4} />
            </button>
          </div>

          <div
            style={{
              backgroundColor: '#f8fbff',
              border: '1px solid #dbe5f1',
              borderRadius: '14px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Current Value
            </span>
            <div
              style={{
                minHeight: '76px',
                borderRadius: '12px',
                border: '2px solid #bfdbfe',
                backgroundColor: 'white',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                color: '#0f172a',
                fontSize: '24px',
                fontWeight: 700,
                wordBreak: 'break-word',
              }}
            >
              {historyFilters.search || <span style={{ color: '#94a3b8', fontWeight: 500 }}>Enter value...</span>}
            </div>
          </div>

          <div
            style={{
              width: '100%',
              backgroundColor: '#ffffff',
              border: '1px solid #dbe5f1',
              borderRadius: '14px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                flexWrap: 'wrap',
                backgroundColor: '#f8fbff',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '8px 10px',
                color: '#1f2937',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                On-screen Keyboard
              </span>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Transaction Search</span>
            </div>

            {rows.map((row, rowIndex) => (
              <div
                key={`history-search-overlay-${rowIndex}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                  gap: '6px',
                }}
              >
                {row.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleHistorySearchCharacter(key)}
                    style={{
                      border: '1px solid #dbe5f1',
                      borderRadius: '10px',
                      backgroundColor: '#f8fafc',
                      color: '#0f172a',
                      padding: '10px 0',
                      fontSize: '15px',
                      fontWeight: 700,
                      boxSizing: 'border-box',
                    }}
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '6px',
              }}
            >
              <button
                type="button"
                onClick={() => setIsHistorySearchKeyboardUppercase((prev) => !prev)}
                style={{
                  border: `1px solid ${isHistorySearchKeyboardUppercase ? '#93c5fd' : '#dbe5f1'}`,
                  borderRadius: '10px',
                  backgroundColor: isHistorySearchKeyboardUppercase ? '#dbeafe' : '#f8fafc',
                  color: isHistorySearchKeyboardUppercase ? '#1d4ed8' : '#334155',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
                aria-label={isHistorySearchKeyboardUppercase ? 'Switch to lowercase' : 'Switch to uppercase'}
                title={isHistorySearchKeyboardUppercase ? 'Switch to lowercase' : 'Switch to uppercase'}
              >
                {isHistorySearchKeyboardUppercase ? <ArrowDown size={16} strokeWidth={2.4} /> : <ArrowUp size={16} strokeWidth={2.4} />}
                <span>{isHistorySearchKeyboardUppercase ? 'a' : 'A'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleHistorySearchCharacter(' ')}
                style={{
                  border: '1px solid #bfdbfe',
                  borderRadius: '10px',
                  backgroundColor: '#eff6ff',
                  color: '#1e3a8a',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Space
              </button>
              <button
                type="button"
                onClick={handleHistorySearchBackspace}
                style={{
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  backgroundColor: '#fff1f2',
                  color: '#991b1b',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Backspace
              </button>
              <button
                type="button"
                onClick={handleHistorySearchClear}
                style={{
                  border: '1px solid #fcd34d',
                  borderRadius: '10px',
                  backgroundColor: '#fffbeb',
                  color: '#92400e',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsHistorySearchKeyboardOpen(false)}
                style={{
                  border: '1px solid #86efac',
                  borderRadius: '10px',
                  backgroundColor: '#f0fdf4',
                  color: '#166534',
                  padding: '10px 0',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAdminNavButton = (view: AdminView, label: string, icon: React.ReactNode) => {
    const isActive = (view === 'settings' && isSettingsOpen) || (!isSettingsOpen && adminView === view);

    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          if (view === 'settings') {
            void handleOpenSettings();
            return;
          }

          setIsSettingsOpen(false);
          setActiveSettingsField(null);
          setIsOverdueTransactionsOpen(false);
          setIsHistoryFiltersOpen(false);
          setIsHistorySearchKeyboardOpen(false);
          setIsSalesFiltersOpen(false);
          setAdminView(view);
        }}
        style={{
          border: isActive ? '1px solid #2563eb' : '1px solid #d1d5db',
          backgroundColor: isActive ? '#eff6ff' : 'white',
          color: isActive ? '#1d4ed8' : '#374151',
          borderRadius: '999px',
          padding: isActive ? '8px 10px' : '8px 14px',
          minWidth: isActive ? '40px' : 'auto',
          fontSize: '14px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: isActive ? '0' : '8px',
          cursor: 'pointer',
        }}
      >
        {icon}
        {!isActive && label}
      </button>
    );
  };

  const historyActiveFilterCount = [
    historyFilters.search,
    historyFilters.status !== HISTORY_FILTER_DEFAULTS.status,
    historyFilters.laundryStatus !== HISTORY_FILTER_DEFAULTS.laundryStatus,
    historyFilters.type !== HISTORY_FILTER_DEFAULTS.type,
    historyFilters.lockerId !== HISTORY_FILTER_DEFAULTS.lockerId,
    historyFilters.startDate,
    historyFilters.endDate,
  ].filter(Boolean).length;

  const salesActiveFilterCount = [
    salesRange.startDate !== defaultSalesRange.startDate,
    salesRange.endDate !== defaultSalesRange.endDate,
  ].filter(Boolean).length;

  const renderHistoryView = () => (
    <>
      <div className="available-lockers-container" style={{ marginTop: '12px', marginBottom: '10px' }}>
        <div className="instructions-header" style={{ marginBottom: '8px' }}>
          <h2 style={{ margin: '0 0 4px 0' }}>Transaction History</h2>
          <p style={{ margin: 0 }}>Search and filter all local laundry transactions.</p>
        </div>
      </div>

      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#4b5563' }}>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{historyTotal} transaction{historyTotal === 1 ? '' : 's'} found</span>
            {historyLoading && <span style={{ fontSize: '13px' }}>Loading history...</span>}
          </div>

          <button
            type="button"
            aria-label={isHistoryFiltersOpen ? 'Close transaction filters' : 'Open transaction filters'}
            title={isHistoryFiltersOpen ? 'Close transaction filters' : 'Open transaction filters'}
            onClick={() => {
              setIsHistoryFiltersOpen((prev) => {
                const nextValue = !prev;
                if (!nextValue) {
                  setIsHistorySearchKeyboardOpen(false);
                }
                return nextValue;
              });
            }}
            style={{
              position: 'relative',
              border: '1px solid #d1d5db',
              borderRadius: '10px',
              backgroundColor: isHistoryFiltersOpen || historyActiveFilterCount > 0 ? '#eff6ff' : 'white',
              color: isHistoryFiltersOpen || historyActiveFilterCount > 0 ? '#1d4ed8' : '#374151',
              padding: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Filter size={18} />
            {historyActiveFilterCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-6px',
                  minWidth: '18px',
                  height: '18px',
                  borderRadius: '999px',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {historyActiveFilterCount}
              </span>
            )}
          </button>
        </div>

        {isHistoryFiltersOpen && (
          <div
            style={{
              backgroundColor: '#f8fbff',
              border: '1px solid #dbe5f1',
              borderRadius: '14px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748b' }}>Filters</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>Transaction History</div>
              </div>
              <button
                type="button"
                onClick={closeHistoryFilters}
                style={{ border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: 'white', color: '#374151', padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
                alignItems: 'end',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                  <input
                    type="text"
                    value={historyFilters.search}
                    readOnly
                    inputMode="none"
                    autoComplete="off"
                    onFocus={handleHistorySearchFocus}
                    onClick={handleHistorySearchFocus}
                    onTouchStart={handleHistorySearchFocus}
                    placeholder="Transaction ID, payment ID, phone, PIN"
                    style={{
                      width: '100%',
                      padding: '10px 12px 10px 34px',
                      borderRadius: '8px',
                      border: isHistorySearchKeyboardOpen ? '2px solid #2563eb' : '1px solid #d1d5db',
                      backgroundColor: '#ffffff',
                      color: '#111827',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Status</label>
                <select
                  value={historyFilters.status}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, status: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb' }}
                >
                  <option value="all">All</option>
                  <option value="Pending">Pending</option>
                  <option value="Completed">Completed</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Laundry</label>
                <select
                  value={historyFilters.laundryStatus}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, laundryStatus: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb' }}
                >
                  <option value="all">All</option>
                  <option value="Dropped">Dropped</option>
                  <option value="Washing">Washing</option>
                  <option value="Done">Done</option>
                  <option value="Ready for Pick-up">Ready for Pick-up</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Type</label>
                <select
                  value={historyFilters.type}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, type: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb' }}
                >
                  <option value="all">All</option>
                  <option value="Clothes">Clothes</option>
                  <option value="Bed Sheets">Bed Sheets</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Locker</label>
                <select
                  value={historyFilters.lockerId}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, lockerId: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb' }}
                >
                  <option value="all">All</option>
                  <option value="1">Locker 1</option>
                  <option value="2">Locker 2</option>
                  <option value="3">Locker 3</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Start Date</label>
                <input
                  type="date"
                  value={historyFilters.startDate}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>End Date</label>
                <input
                  type="date"
                  value={historyFilters.endDate}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                  style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#f9fafb' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setHistoryFilters(HISTORY_FILTER_DEFAULTS);
                  setAppliedHistoryFilters(HISTORY_FILTER_DEFAULTS);
                  setIsHistorySearchKeyboardOpen(false);
                  setIsHistoryFiltersOpen(false);
                }}
                style={{ border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: 'white', color: '#374151', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppliedHistoryFilters(historyFilters);
                  setIsHistorySearchKeyboardOpen(false);
                  setIsHistoryFiltersOpen(false);
                }}
                style={{ border: 'none', borderRadius: '8px', backgroundColor: '#2563eb', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {historyError && (
          <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontWeight: 600 }}>
            {historyError}
          </div>
        )}

        {!isHistoryFiltersOpen && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', color: '#374151' }}>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Transaction</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Locker</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Weight</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Price</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Customer</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Dates</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', textTransform: 'uppercase' }}>Payment</th>
              </tr>
            </thead>
            <tbody>
              {!historyLoading && historyTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
                    No transactions match the current filters.
                  </td>
                </tr>
              ) : (
                historyTransactions.map((item) => (
                  <tr key={item.id} style={{ borderTop: '1px solid #e5e7eb', backgroundColor: item.status === 'Pending' ? '#fcfcff' : 'white' }}>
                    <td style={{ padding: '12px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 700, color: '#111827' }}>{item.id}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>PIN: {item.pinCode}</div>
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'top', color: '#374151' }}>
                      {item.lockerId !== null ? `Locker ${item.lockerId}` : item.archivedFromLockerId !== null ? `Archived from ${item.archivedFromLockerId}` : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'top', color: '#374151' }}>{item.laundryType}</td>
                    <td style={{ padding: '12px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 700, color: '#1f2937' }}>{item.status}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{item.laundryStatus}</div>
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'top', color: '#374151' }}>{formatWeight(item.weight)}</td>
                    <td style={{ padding: '12px', verticalAlign: 'top', color: '#111827', fontWeight: 700 }}>{formatCurrency(item.price)}</td>
                    <td style={{ padding: '12px', verticalAlign: 'top', color: '#374151' }}>
                      <div>{item.phoneNumber || 'N/A'}</div>
                      {item.note && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{item.note}</div>}
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'top', fontSize: '12px', color: '#4b5563', lineHeight: 1.6 }}>
                      <div>Dropped: {formatDateTime(item.droppedAt)}</div>
                      <div>Done: {formatDateTime(item.doneAt)}</div>
                      <div>Picked Up: {formatDateTime(item.pickedUpAt)}</div>
                    </td>
                    <td style={{ padding: '12px', verticalAlign: 'top', color: '#374151' }}>{item.paymentId || 'N/A'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </>
  );

  const renderSalesView = () => (
    <>
      <div className="available-lockers-container" style={{ marginTop: '12px', marginBottom: '10px' }}>
        <div className="instructions-header" style={{ marginBottom: '8px' }}>
          <h2 style={{ margin: '0 0 4px 0' }}>Sales Report</h2>
          <p style={{ margin: 0 }}>View completed pickups and sales totals for a selected date range.</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0 }}>
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#4b5563' }}>
              <span style={{ fontSize: '14px', fontWeight: 600 }}>
                {appliedSalesRange.startDate || 'Start'} to {appliedSalesRange.endDate || 'End'}
              </span>
              {salesLoading && <span style={{ fontSize: '13px', color: '#6b7280' }}>Loading sales...</span>}
            </div>

            <button
              type="button"
              aria-label="Open sales filters"
              title="Open sales filters"
              onClick={() => setIsSalesFiltersOpen((prev) => !prev)}
              style={{
                position: 'relative',
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                backgroundColor: isSalesFiltersOpen || salesActiveFilterCount > 0 ? '#eff6ff' : 'white',
                color: isSalesFiltersOpen || salesActiveFilterCount > 0 ? '#1d4ed8' : '#374151',
                padding: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Filter size={18} />
              {salesActiveFilterCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    minWidth: '18px',
                    height: '18px',
                    borderRadius: '999px',
                    backgroundColor: '#2563eb',
                    color: 'white',
                    fontSize: '11px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 4px',
                  }}
                >
                  {salesActiveFilterCount}
                </span>
              )}
            </button>
          </div>

          {isSalesFiltersOpen && (
            <div
              style={{
                backgroundColor: '#f8fbff',
                border: '1px solid #dbe5f1',
                borderRadius: '14px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748b' }}>Filters</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>Sales Range</div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSalesFiltersOpen(false)}
                  style={{ border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: 'white', color: '#374151', padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>Start Date</label>
                  <input
                    type="date"
                    value={salesRange.startDate}
                    onChange={(e) => setSalesRange((prev) => ({ ...prev, startDate: e.target.value }))}
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#ffffff' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>End Date</label>
                  <input
                    type="date"
                    value={salesRange.endDate}
                    onChange={(e) => setSalesRange((prev) => ({ ...prev, endDate: e.target.value }))}
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#ffffff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSalesRange(defaultSalesRange);
                    setAppliedSalesRange(defaultSalesRange);
                    setIsSalesFiltersOpen(false);
                  }}
                  style={{ border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: 'white', color: '#374151', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedSalesRange(salesRange);
                    setIsSalesFiltersOpen(false);
                  }}
                  style={{ border: 'none', borderRadius: '8px', backgroundColor: '#2563eb', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Apply Range
                </button>
              </div>
            </div>
          )}
        </div>

        {salesError && (
          <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontWeight: 600 }}>
            {salesError}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {[
            { label: 'Total Sales', value: formatCurrency(salesData.summary.totalSales), tone: '#dcfce7', color: '#166534' },
            { label: 'Completed Transactions', value: String(salesData.summary.totalTransactions), tone: '#dbeafe', color: '#1d4ed8' },
            { label: 'Average Sale', value: formatCurrency(salesData.summary.averageSale), tone: '#fef3c7', color: '#92400e' },
          ].map((card) => (
            <div key={card.label} style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '10px' }}>{card.label}</div>
              <div style={{ display: 'inline-flex', backgroundColor: card.tone, color: card.color, padding: '10px 12px', borderRadius: '10px', fontSize: '22px', fontWeight: 800 }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

      </div>
    </>
  );


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
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <BackgroundBubbles variant="tinted" />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        
        <button 
          onClick={() => {
            if (isSettingsOpen) {
              setIsSettingsOpen(false);
              setAdminView('dashboard');
              setActiveSettingsField(null);
            } else {
              onBack();
            }
          }} 
          className="btn-return-absolute" 
          style={{ zIndex: 10 }}
        >
          <ArrowLeft size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Return
        </button>

        <div style={{ marginTop: '12px', marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              backgroundColor: 'rgba(255,255,255,0.92)',
              border: '1px solid #e5e7eb',
              borderRadius: '999px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              padding: '6px',
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            {renderAdminNavButton('dashboard', 'Dashboard', <LayoutDashboard size={16} />)}
            {renderAdminNavButton('history', 'Transactions', <History size={16} />)}
            {renderAdminNavButton('sales', 'Sales', <BarChart3 size={16} />)}
            {renderAdminNavButton('settings', 'Settings', <Settings size={16} />)}
          </div>
        </div>

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

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                width: '100%',
                paddingRight: '4px',
              }}
            >
              <form 
                onSubmit={handleSaveSettings}
                style={{
                  width: '100%',
                  maxWidth: '980px',
                  flex: '0 0 auto',
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  overflowY: 'visible',
                  overflowX: 'hidden',
                  minHeight: 'auto',
                  colorScheme: 'light'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>Laundry Shop Name</label>
                  <input
                    type="text"
                    value={shopName}
                    readOnly
                    inputMode="none"
                    autoComplete="off"
                    onFocus={() => handleSettingsFieldFocus('shopName', 'text')}
                    onClick={() => handleSettingsFieldFocus('shopName', 'text')}
                    onTouchStart={() => handleSettingsFieldFocus('shopName', 'text')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: activeSettingsField === 'shopName' ? '2px solid #2563eb' : '1px solid #d1d5db',
                      backgroundColor: '#f9fafb',
                      fontSize: '16px',
                      color: '#000000',
                      colorScheme: 'light',
                      outline: 'none',
                    }}
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
                          type="text"
                          name="clothesPrice"
                          value={prices.clothesPrice}
                          readOnly
                          inputMode="none"
                          onFocus={() => handleSettingsFieldFocus('clothesPrice', 'number')}
                          onClick={() => handleSettingsFieldFocus('clothesPrice', 'number')}
                          onTouchStart={() => handleSettingsFieldFocus('clothesPrice', 'number')}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: activeSettingsField === 'clothesPrice' ? '2px solid #2563eb' : '1px solid #d1d5db',
                            backgroundColor: '#f9fafb',
                            color: '#000000',
                            boxSizing: 'border-box',
                            colorScheme: 'light',
                            outline: 'none',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563', display: 'block', marginBottom: '4px' }}>Minimum Total Price (₱)</label>
                        <input
                          type="text"
                          name="minClothesPrice"
                          value={prices.minClothesPrice}
                          readOnly
                          inputMode="none"
                          onFocus={() => handleSettingsFieldFocus('minClothesPrice', 'number')}
                          onClick={() => handleSettingsFieldFocus('minClothesPrice', 'number')}
                          onTouchStart={() => handleSettingsFieldFocus('minClothesPrice', 'number')}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: activeSettingsField === 'minClothesPrice' ? '2px solid #2563eb' : '1px solid #d1d5db',
                            backgroundColor: '#f9fafb',
                            color: '#000000',
                            boxSizing: 'border-box',
                            colorScheme: 'light',
                            outline: 'none',
                          }}
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
                          type="text"
                          name="bedSheetPrice"
                          value={prices.bedSheetPrice}
                          readOnly
                          inputMode="none"
                          onFocus={() => handleSettingsFieldFocus('bedSheetPrice', 'number')}
                          onClick={() => handleSettingsFieldFocus('bedSheetPrice', 'number')}
                          onTouchStart={() => handleSettingsFieldFocus('bedSheetPrice', 'number')}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: activeSettingsField === 'bedSheetPrice' ? '2px solid #2563eb' : '1px solid #d1d5db',
                            backgroundColor: '#f9fafb',
                            color: '#000000',
                            boxSizing: 'border-box',
                            colorScheme: 'light',
                            outline: 'none',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563', display: 'block', marginBottom: '4px' }}>Minimum Total Price (₱)</label>
                        <input
                          type="text"
                          name="minBedSheetPrice"
                          value={prices.minBedSheetPrice}
                          readOnly
                          inputMode="none"
                          onFocus={() => handleSettingsFieldFocus('minBedSheetPrice', 'number')}
                          onClick={() => handleSettingsFieldFocus('minBedSheetPrice', 'number')}
                          onTouchStart={() => handleSettingsFieldFocus('minBedSheetPrice', 'number')}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: activeSettingsField === 'minBedSheetPrice' ? '2px solid #2563eb' : '1px solid #d1d5db',
                            backgroundColor: '#f9fafb',
                            color: '#000000',
                            boxSizing: 'border-box',
                            colorScheme: 'light',
                            outline: 'none',
                          }}
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
                  {saveStatus === 'success' && <span style={{ color: '#059669', fontWeight: 600, fontSize: '14px' }}>Settings saved successfully.</span>}
                  {saveStatus === 'error' && <span style={{ color: '#dc2626', fontWeight: 600, fontSize: '14px' }}>Failed to save. Check server connection.</span>}
                </div>
              </form>
            </div>
          </>
        ) : (
          <>
            {adminView === 'dashboard' ? (
              <>
                <div className="available-lockers-container" style={{ marginTop: '4px', marginBottom: '10px' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '18px', color: '#1f2937', margin: 0 }}>Locker Overview</h3>
                  <button
                    type="button"
                    onClick={() => setIsOverdueTransactionsOpen((prev) => !prev)}
                    style={{
                      position: 'relative',
                      border: '1px solid #d1d5db',
                      borderRadius: '10px',
                      backgroundColor: isOverdueTransactionsOpen || overdueTransactions.length > 0 ? '#fff7ed' : 'white',
                      color: isOverdueTransactionsOpen || overdueTransactions.length > 0 ? '#c2410c' : '#374151',
                      padding: '8px 12px',
                      fontSize: '13px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Overdue Transactions
                    {overdueTransactions.length > 0 && (
                      <span
                        style={{
                          minWidth: '18px',
                          height: '18px',
                          borderRadius: '999px',
                          backgroundColor: '#ea580c',
                          color: 'white',
                          fontSize: '11px',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 4px',
                        }}
                      >
                        {overdueTransactions.length}
                      </span>
                    )}
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {isOverdueTransactionsOpen ? (
                    overdueTransactions.length === 0 ? (
                      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', textAlign: 'center', padding: '16px' }}>
                        <p style={{ fontSize: '14px' }}>No overdue transactions right now.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                        {overdueTransactions.map((item) => (
                          <div
                            key={item.id}
                            style={{
                              border: '1px solid #fed7aa',
                              backgroundColor: '#fff7ed',
                              borderRadius: '12px',
                              padding: '12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '14px', fontWeight: 700, color: '#9a3412' }}>{item.id}</span>
                                <span style={{ fontSize: '12px', color: '#7c2d12' }}>
                                  Locker {item.lockerId ?? 'N/A'} • {item.laundryType}
                                </span>
                              </div>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: '#b45309', backgroundColor: '#ffedd5', borderRadius: '999px', padding: '4px 8px' }}>
                                Overdue
                              </span>
                            </div>

                            <div style={{ fontSize: '12px', color: '#7c2d12', lineHeight: 1.6 }}>
                              <div><strong>Customer:</strong> {item.phoneNumber || 'N/A'}</div>
                              <div><strong>Price:</strong> {formatCurrency(item.price)}</div>
                              <div><strong>Done At:</strong> {formatDateTime(item.doneAt)}</div>
                              <div><strong>Status:</strong> {item.status}</div>
                            </div>

                            <button
                              type="button"
                              onClick={() => void handleMarkOverdueAsPaid(item.id)}
                              disabled={settlingOverdueTransactionId === item.id || item.status === 'Completed'}
                              style={{
                                width: '100%',
                                border: 'none',
                                borderRadius: '8px',
                                backgroundColor: item.status === 'Completed'
                                  ? '#cbd5e1'
                                  : settlingOverdueTransactionId === item.id
                                    ? '#fdba74'
                                    : '#ea580c',
                                color: 'white',
                                padding: '10px',
                                fontWeight: 700,
                                cursor: item.status === 'Completed'
                                  ? 'default'
                                  : settlingOverdueTransactionId === item.id
                                    ? 'progress'
                                    : 'pointer',
                              }}
                            >
                              {item.status === 'Completed'
                                ? 'Already Paid'
                                : settlingOverdueTransactionId === item.id
                                  ? 'Marking Paid...'
                                  : 'Mark as Paid'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  ) : loading ? (
                    <p style={{ color: '#6b7280' }}>Loading lockers...</p>
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
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
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
                          Back to Locker Details
                        </button>

                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.7 }}>
                            <p><strong>TRN-ID:</strong> {transaction.id}</p>
                            <p><strong>Pin Code:</strong> {transaction.pinCode}</p>
                            <p><strong>Weight:</strong> {formatWeight(transaction.weight)}</p>
                            <p><strong>Price:</strong> {formatCurrency(transaction.price)}</p>
                            <p><strong>Type:</strong> {transaction.laundryType}</p>
                            <p>
                              <strong>Status:</strong>{' '}
                              <span className={`px-2 py-1 rounded-full text-xs ${getStatusDisplayInfo(transaction).colorClass}`}>
                                {getStatusDisplayInfo(transaction).text}
                              </span>
                            </p>
                          </div>

                          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '2px' }}>
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

                            {(transaction.laundryStatus === 'Done' || transaction.laundryStatus === 'Ready for Pick-up') && (
                              <>
                                <div
                                  style={{
                                    border: '1px solid #fcd34d',
                                    borderRadius: '8px',
                                    backgroundColor: '#fffbeb',
                                    color: '#92400e',
                                    fontSize: '12px',
                                    padding: '8px',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '6px',
                                    lineHeight: 1.4,
                                  }}
                                >
                                  <Info size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                                  {transaction.reminderSent
                                    ? 'Locker is already marked overdue. Resetting will archive this active transaction and clear the locker.'
                                    : 'Warning: this action will archive the current transaction and clear the locker even if it is not yet overdue.'}
                                </div>
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
                              </>
                            )}

                            <button
                              onClick={printReceipt}
                              style={{
                                width: '100%',
                                border: '2px solid #d1d5db',
                                borderRadius: '8px',
                                backgroundColor: 'white',
                                color: '#374151',
                                padding: '10px 8px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                whiteSpace: 'normal',
                                textAlign: 'center',
                                lineHeight: 1.3,
                              }}
                            >
                              <Printer size={16} /> Print Receipt
                            </button>
                          </div>
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
            ) : adminView === 'history' ? (
              renderHistoryView()
            ) : (
              renderSalesView()
            )}
          </>
        )}

        {isSettingsOpen && renderSettingsKeyboardOverlay()}
        {!isSettingsOpen && adminView === 'history' && renderHistorySearchKeyboardOverlay()}
      </div>
    </div>
  );
}
