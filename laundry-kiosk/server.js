import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

// --- FIREBASE IMPORTS ---
import { db, auth } from './firebaseConfig.js'; // <--- Import auth
import { doc, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth"; // <--- Import sign in

// --- PATH SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'hardware.log');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const ARDUINO_PORT = '/dev/ttyUSB0'; 
const BAUD_RATE = 9600;
const WEIGHT_THRESHOLD = 0.1;

// --- STATE STORAGE ---
let systemState = {
  l1: { door: 'CLOSED', weight: 0.0 }, 
  l2: { door: 'CLOSED', weight: 0.0 },
  credit: 0.0
};

// --- LOGGING FUNCTION ---
function logHardware(data) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] ${data}\n`;
  fs.appendFile(LOG_FILE, logEntry, (err) => {
    if (err) console.error(`Failed to write to log: ${err.message}`);
  });
}

// --- FIREBASE SYNC FUNCTION ---
let lastUploadTime = 0;
const UPLOAD_INTERVAL = 2000; 

async function syncToFirebase() {
  // Ensure we are authenticated before writing
  if (!auth.currentUser) { 
    console.log("Waiting for auth to sync...");
    return;
  }

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
// Start the listener immediately
signInAnonymously(auth)
  .then(() => {
    console.log("✅ Firebase: Signed in anonymously");
  })
  .catch((error) => {
    console.error("❌ Firebase Auth Error:", error.message);
  });

// --- SERIAL CONNECTION ---
let port;
try {
  port = new SerialPort({ path: ARDUINO_PORT, baudRate: BAUD_RATE });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('data', (line) => {
    const text = line.trim();
    console.log(`Arduino: ${text}`); 
    logHardware(text);

    let stateChanged = false;

    // 1. Parse Credit
    if (text.includes('CREDIT')) {
      const creditMatch = text.match(/CREDIT:?\s*([\d\.]+)/);
      if (creditMatch && creditMatch[1]) {
        const val = parseFloat(creditMatch[1]);
        if (!isNaN(val) && systemState.credit !== val) {
          systemState.credit = val;
          stateChanged = true;
        }
      }
    }

    // 2. Parse Locker 1
    if (text.startsWith('L1:')) {
      const doorMatch = text.match(/\[(.*?)\]/);
      const weightMatch = text.match(/Wt:\s*([\d\.]+)/);
      
      if (weightMatch) {
        const w = parseFloat(weightMatch[1]);
        if (Math.abs(systemState.l1.weight - w) > 0.01) {
          systemState.l1.weight = w;
          stateChanged = true;
        }
      }
      if (doorMatch) {
        let rawDoorStatus = doorMatch[1].trim();
        if (systemState.l1.weight > WEIGHT_THRESHOLD) {
            rawDoorStatus = 'CLOSED';
        }
        if (systemState.l1.door !== rawDoorStatus) {
          systemState.l1.door = rawDoorStatus;
          stateChanged = true;
        }
      }
    }

    // 3. Parse Locker 2
    if (text.startsWith('L2:')) {
      const doorMatch = text.match(/\[(.*?)\]/);
      const weightMatch = text.match(/Wt:\s*([\d\.]+)/);
      
      if (weightMatch) {
        const w = parseFloat(weightMatch[1]);
        if (Math.abs(systemState.l2.weight - w) > 0.01) {
          systemState.l2.weight = w;
          stateChanged = true;
        }
      }
      if (doorMatch) {
        let rawDoorStatus = doorMatch[1].trim();
        if (systemState.l2.weight > WEIGHT_THRESHOLD) {
            rawDoorStatus = 'CLOSED';
        }
        if (systemState.l2.door !== rawDoorStatus) {
          systemState.l2.door = rawDoorStatus;
          stateChanged = true;
        }
      }
    }

    if (stateChanged) {
      syncToFirebase();
    }
  });

  port.on('error', (err) => {
    console.error('Serial Port Error: ', err.message);
  });

} catch (err) {
  console.error("FAILED TO OPEN SERIAL PORT:", err.message);
}

// --- API ---
app.get('/api/status', (req, res) => res.json(systemState));

app.post('/api/unlock', (req, res) => {
  const { lockerId } = req.body;
  
  if (!port) {
    return res.status(500).json({ error: "Hardware not connected" });
  }

  if (lockerId === 1) {
    port.write('1\n');
    logHardware('SENT COMMAND: 1 (Unlock L1)');
    res.json({ success: true });
  } else if (lockerId === 2) {
    port.write('2\n');
    logHardware('SENT COMMAND: 2 (Unlock L2)');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Invalid Locker ID" });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));