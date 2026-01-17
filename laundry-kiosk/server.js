import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

// --- FIREBASE IMPORTS ---
import { db, auth } from './firebaseConfig.js'; 
import { doc, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth"; 

// --- PATH SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'hardware.log');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
// CHANGE THIS TO YOUR ACTUAL PORT (e.g., 'COM3' on Windows, '/dev/ttyUSB0' on Linux)
const ARDUINO_PORT = '/dev/ttyUSB0'; 
const BAUD_RATE = 9600;
const WEIGHT_THRESHOLD = 0.1;

// --- STATE STORAGE ---
let systemState = {
  l1: { door: 'CLOSED', weight: 0.0 }, 
  l2: { door: 'CLOSED', weight: 0.0 },
  credit: 0.0
};

// --- SIMULATION MODE STATE ---
// If hardware fails to connect, we use this to simulate weight for UI testing
let isSimulationMode = false;

// --- LOGGING FUNCTION ---
function logHardware(data) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] ${data}\n`;
  console.log(logEntry.trim()); // Also log to console
  fs.appendFile(LOG_FILE, logEntry, (err) => {
    if (err) console.error(`Failed to write to log: ${err.message}`);
  });
}

// --- FIREBASE SYNC FUNCTION ---
let lastUploadTime = 0;
const UPLOAD_INTERVAL = 2000; 

async function syncToFirebase() {
  if (!auth.currentUser) return;

  const now = Date.now();
  if (now - lastUploadTime > UPLOAD_INTERVAL) {
    try {
      await setDoc(doc(db, "kiosks", "main_unit"), {
        ...systemState,
        lastUpdated: new Date()
      });
      lastUploadTime = now;
    } catch (e) {
      console.error("Firebase Sync Error:", e.message);
    }
  }
}

// --- AUTHENTICATION INIT ---
signInAnonymously(auth).catch((error) => console.error("Firebase Auth Error:", error.message));

// --- SERIAL CONNECTION ---
let port;
try {
  port = new SerialPort({ path: ARDUINO_PORT, baudRate: BAUD_RATE });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  console.log(`✅ CONNECTED TO HARDWARE ON ${ARDUINO_PORT}`);

  parser.on('data', (line) => {
    const text = line.trim();
    logHardware(`Arduino: ${text}`);

    let stateChanged = false;

    // 1. Parse Credit
    if (text.includes('CREDIT')) {
      const creditMatch = text.match(/CREDIT:?\s*([\d\.]+)/);
      if (creditMatch && creditMatch[1]) {
        systemState.credit = parseFloat(creditMatch[1]);
        stateChanged = true;
      }
    }

    // 2. Parse Locker 1
    if (text.startsWith('L1:')) {
      const weightMatch = text.match(/Wt:\s*([\d\.]+)/);
      const doorMatch = text.match(/\[(.*?)\]/);
      
      if (weightMatch) {
        systemState.l1.weight = parseFloat(weightMatch[1]);
        stateChanged = true;
      }
      if (doorMatch) {
        systemState.l1.door = doorMatch[1].trim();
        stateChanged = true;
      }
    }

    // 3. Parse Locker 2
    if (text.startsWith('L2:')) {
      const weightMatch = text.match(/Wt:\s*([\d\.]+)/);
      const doorMatch = text.match(/\[(.*?)\]/);
      
      if (weightMatch) {
        systemState.l2.weight = parseFloat(weightMatch[1]);
        stateChanged = true;
      }
      if (doorMatch) {
        systemState.l2.door = doorMatch[1].trim();
        stateChanged = true;
      }
    }

    if (stateChanged) syncToFirebase();
  });

  port.on('error', (err) => {
    console.error('Serial Port Error:', err.message);
    startSimulationMode();
  });

} catch (err) {
  console.error("❌ HARDWARE CONNECTION FAILED:", err.message);
  startSimulationMode();
}

function startSimulationMode() {
  if (isSimulationMode) return;
  isSimulationMode = true;
  console.log("⚠️  STARTING SIMULATION MODE (For UI Testing) ⚠️");
  console.log("   - Use POST /api/debug/weight to set weight manually");
  console.log("   - Or wait for auto-simulation");
}

// --- API ---
app.get('/api/status', (req, res) => res.json(systemState));

app.post('/api/unlock', (req, res) => {
  const { lockerId } = req.body;
  
  if (isSimulationMode) {
    console.log(`[SIMULATION] Unlocking Locker ${lockerId}...`);
    // Simulate someone putting clothes in after unlocking
    setTimeout(() => {
        if (lockerId === 1) systemState.l1.weight = 3.5; // Simulate 3.5kg
        if (lockerId === 2) systemState.l2.weight = 4.2; // Simulate 4.2kg
        console.log(`[SIMULATION] Weight detected in Locker ${lockerId}`);
    }, 2000);
    return res.json({ success: true, mode: 'simulation' });
  }

  if (!port) return res.status(500).json({ error: "Hardware not connected" });

  if (lockerId === 1) port.write('1\n');
  else if (lockerId === 2) port.write('2\n');
  else return res.status(400).json({ error: "Invalid Locker ID" });

  res.json({ success: true });
});

// DEBUG ENDPOINT: Manually set weight for UI testing
// Usage: curl -X POST -H "Content-Type: application/json" -d '{"lockerId": 1, "weight": 5.5}' http://localhost:3000/api/debug/weight
app.post('/api/debug/weight', (req, res) => {
    const { lockerId, weight } = req.body;
    if (lockerId === 1) systemState.l1.weight = parseFloat(weight);
    if (lockerId === 2) systemState.l2.weight = parseFloat(weight);
    res.json({ success: true, newState: systemState });
});

app.listen(3000, () => console.log('Server running on port 3000'));