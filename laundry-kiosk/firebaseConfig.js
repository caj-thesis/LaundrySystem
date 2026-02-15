import { initializeApp } from "firebase/app";
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyARrGx7wbz8ZPPIxmG8hoMcLCwtjdzjr8w",

  authDomain: "caj-laundry-management-49191.firebaseapp.com",

  projectId: "caj-laundry-management-49191",

  storageBucket: "caj-laundry-management-49191.firebasestorage.app",

  messagingSenderId: "82008219104",

  appId: "1:82008219104:web:96ae4d2453248270899f85",

  measurementId: "G-HD7R1PKYLK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with Offline Persistence Enabled
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    // allow the kiosk to work even if opened in multiple tabs
    tabManager: persistentMultipleTabManager() 
  })
});

export const auth = getAuth(app);