// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// REPLACE THE PLACEHOLDERS WITH YOUR ACTUAL KEYS FROM FIREBASE CONSOLE
const firebaseConfig = {
  apiKey: "AIzaSyAg9_Om1OD_zzI09ncFqBpmXJbLtygnuZM",
  authDomain: "caj-laundry-management.firebaseapp.com",
  projectId: "caj-laundry-management",
  storageBucket: "caj-laundry-management.firebasestorage.app",
  messagingSenderId: "359493566804",
  appId: "1:359493566804:web:7c8280f7323cf14152c8c1",
  measurementId: "G-F5K0VTNPQ1"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);