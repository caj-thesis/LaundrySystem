import { exec } from 'child_process'; // Add this one line at the top

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
const ARDUINO_PORT = '/dev/ttyUSB0'; 
const BAUD_RATE = 115200; // Changed from 9600

// --- STATE STORAGE ---
let systemState = {
  l1: { door: 'CLOSED', weight: 0.0 }, 
  l2: { door: 'CLOSED', weight: 0.0 },
  credit: 0.0
};

// --- SIMULATION MODE STATE ---
let isSimulationMode = false;

// --- LOGGING FUNCTION ---
function logHardware(data) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] ${data}\n`;
  console.log(logEntry.trim()); 
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

 
// --- Updated Serial Parsing in server.js ---
parser.on('data', (line) => {
    const text = line.trim();
    logHardware(`Arduino: ${text}`);

    // If the line starts with "DATA", it contains our locker info
    if (text.startsWith('DATA')) {
        const parts = text.split('|'); // Splits into ["DATA", "L1:0.0:CLOSED", "L2:0.0:CLOSED"...]
        
        parts.forEach(part => {
            // Check for Locker 1
            if (part.startsWith('L1:')) {
                const data = part.split(':'); // ["L1", "0.0", "CLOSED"]
                systemState.l1.weight = parseFloat(data[1]) || 0;
                systemState.l1.door = data[2];
            }
            // Check for Locker 2
            if (part.startsWith('L2:')) {
                const data = part.split(':');
                systemState.l2.weight = parseFloat(data[1]) || 0;
                systemState.l2.door = data[2];
            }
            // Check for Credit
            if (part.startsWith('CREDIT:')) {
                systemState.credit = parseFloat(part.split(':')[1]) || 0;
            }
        });

        syncToFirebase(); // Send the real weight to your database
    }
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
  console.log("⚠️  STARTING SIMULATION MODE (UI Testing) ⚠️");
  console.log("   - Weights will simulate IMMEDIATELY upon unlock.");
}

// --- API ---
app.get('/api/status', (req, res) => res.json(systemState));

app.post('/api/unlock', (req, res) => {
  const { lockerId } = req.body;
  
  // --- UPDATED: IMMEDIATE SIMULATION ---
  if (isSimulationMode) {
    console.log(`[SIMULATION] Unlocking Locker ${lockerId}...`);
    
    // NO DELAY (setTimeout removed)
    if (lockerId === 1) systemState.l1.weight = 3.5; 
    if (lockerId === 2) systemState.l2.weight = 4.2; 
    
    console.log(`[SIMULATION] Weight detected immediately in Locker ${lockerId}`);
    return res.json({ success: true, mode: 'simulation' });
  }

  if (!port) return res.status(500).json({ error: "Hardware not connected" });

  if (lockerId === 1) port.write('1\n');
  else if (lockerId === 2) port.write('2\n');
  else return res.status(400).json({ error: "Invalid Locker ID" });

  res.json({ success: true });
});

app.post('/api/debug/weight', (req, res) => {
    const { lockerId, weight } = req.body;
    if (lockerId === 1) systemState.l1.weight = parseFloat(weight);
    if (lockerId === 2) systemState.l2.weight = parseFloat(weight);
    res.json({ success: true, newState: systemState });
});

// --- ADD ONLY THIS ENDPOINT FOR PRINTING ---
app.post('/api/print', (req, res) => {
  const { transactionId, pin, processType, weight, price } = req.body;

  const receiptText = `
    CAJ LAUNDRY LOCKER CO.
   --------------------------
   Date: ${new Date().toLocaleString()}
   Trans #: ${transactionId || 'N/A'}
   Service: ${processType.toUpperCase()}
   --------------------------
   ${processType === 'dropoff' 
     ? `YOUR PIN: ${pin}\\n   Keep this PIN safe!` 
     : `Weight: ${weight} kg\\n   Paid: PHP ${price}`
   }
   --------------------------
   Thank you for using our
    Laundry Locker Service!
   
   
   
  `;

  // Using printf avoids the "-e" text and is cleaner for thermal printers
  exec(`printf "${receiptText}" > /dev/usb/lp0`, (error) => {
    if (error) {
      console.error('Hardware Print Error:', error);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Add this to your server.js to handle the locking command
// server.js
app.post('/api/lock', (req, res) => {
  const { lockerId } = req.body;
  
  // These characters 'a', 'b', 'c' match your Arduino 'LOCK' logic
  const lockCommands = { 1: 'a', 2: 'b', 3: 'c' };
  const cmd = lockCommands[lockerId];

  if (port && cmd) {
    port.write(`${cmd}\n`); 
    console.log(`Sent LOCK command to Arduino: ${cmd}`);
    res.json({ success: true });
  } else {
    // If hardware isn't connected, still return success for UI testing
    res.json({ success: true, warning: "Hardware not connected" });
  }
});


app.listen(3000, () => console.log('Server running on port 3000'));