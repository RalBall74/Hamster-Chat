import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, setDoc, getDocs, writeBatch, updateDoc, deleteDoc, limit, arrayUnion, arrayRemove, deleteField } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBExnlz9mgSd7RvtAcg8BGZSmm2UV3X-3k",
    authDomain: "hamster-chat74.firebaseapp.com",
    projectId: "hamster-chat74",
    storageBucket: "hamster-chat74.firebasestorage.app",
    messagingSenderId: "28131470196",
    appId: "1:28131470196:web:9cd057bec4aadeb5a1c530",
    measurementId: "G-0RCC85VVVL"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export {
    auth, db, storage, googleProvider,
    onAuthStateChanged, signInWithPopup, signOut,
    collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, setDoc, getDocs, writeBatch, updateDoc, deleteDoc, limit, arrayUnion, arrayRemove, deleteField
};