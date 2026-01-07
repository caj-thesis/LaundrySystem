import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

// --- PATH SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'hardware.log');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const ARDUINO_PORT = '/dev/ttyUSB0'; // Ensure this matches your ls /dev/tty*
const BAUD_RATE = 9600;

// --- SERIAL CONNECTION ---
const port = new SerialPort({ path: ARDUINO_PORT, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

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
  
  // Append to the file
  fs.appendFile(LOG_FILE, logEntry, (err) => {
    if (err) console.error(`Failed to write to log: ${err.message}`);
  });
}

// --- FORCE CREATE LOG ON STARTUP ---
try {
  const startMessage = `\n--- SERVER RESTARTED at ${new Date().toLocaleString()} ---\n`;
  fs.appendFileSync(LOG_FILE, startMessage);
  console.log(`✅ Log file created at: ${LOG_FILE}`);
} catch (err) {
  console.error(`❌ CRITICAL ERROR: Could not create log file. Check permissions! \n${err.message}`);
}

// --- PARSER LOGIC ---
parser.on('data', (line) => {
  const text = line.trim();
  console.log(`Arduino: ${text}`); 
  logHardware(text);

  // Parse Credit (Fast & Slow)
  if (text.includes('TOTAL CREDIT:') || text.startsWith('CREDIT:')) {
    const match = text.match(/[\d\.]+/);
    if (match) systemState.credit = parseFloat(match[0]);
  }

  // Parse Locker 1 (L6)
  if (text.startsWith('L1:')) {
    const doorMatch = text.match(/\[(.*?)\]/);
    const weightMatch = text.match(/Wt:\s*([\d\.]+)/);
    if (doorMatch) systemState.l1.door = doorMatch[1].trim();
    if (weightMatch) systemState.l1.weight = parseFloat(weightMatch[1]);
  }

  // Parse Locker 2 (L8)
  if (text.startsWith('L2:')) {
    const doorMatch = text.match(/\[(.*?)\]/);
    const weightMatch = text.match(/Wt:\s*([\d\.]+)/);
    if (doorMatch) systemState.l2.door = doorMatch[1].trim();
    if (weightMatch) systemState.l2.weight = parseFloat(weightMatch[1]);
  }
});

// --- API ---
app.get('/api/status', (req, res) => res.json(systemState));

app.post('/api/unlock', (req, res) => {
  const { lockerId } = req.body;
  if (lockerId === 6) {
    port.write('1\n');
    logHardware('SENT COMMAND: 1 (Unlock L6)');
    res.json({ success: true });
  } else if (lockerId === 8) {
    port.write('2\n');
    logHardware('SENT COMMAND: 2 (Unlock L8)');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Invalid Locker" });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));