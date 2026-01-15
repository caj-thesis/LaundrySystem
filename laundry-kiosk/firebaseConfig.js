import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {

  apiKey: "AIzaSyDOcQa3lv6_qBSlVlGf3o-jOWElx0ax0R0",

  authDomain: "caj-laundry-management-49191.firebaseapp.com",

  projectId: "caj-laundry-management-49191",

  storageBucket: "caj-laundry-management-49191.firebasestorage.app",

  messagingSenderId: "82008219104",

  appId: "1:82008219104:web:8723f28cd7d5a27a899f85",

  measurementId: "G-7VJMSZMKT6"

};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);