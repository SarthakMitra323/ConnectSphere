import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  orderBy,
  writeBatch,
  deleteDoc,
  limit,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD8Il1stHhvl_PgqwoN2-rKZQXut3B-qAY',
  authDomain: 'connectsphere-web.firebaseapp.com',
  projectId: 'connectsphere-web',
  messagingSenderId: '477654366755',
  appId: '1:477654366755:web:1577289f86ea71c3734f96',
  measurementId: 'G-4YPV9Y5ZJQ'
};

export const appId = typeof __app_id !== 'undefined' ? __app_id : 'connectsphere-app';
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const messaging = getMessaging(app);

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  orderBy,
  writeBatch,
  deleteDoc,
  limit,
  runTransaction,
  getToken,
  onMessage
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ENCRYPTION_PASSPHRASE = 'connectsphere-message-encryption-v1';
const ENCRYPTION_ITERATIONS = 120000;

async function deriveChatKey(chatId) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(`${ENCRYPTION_PASSPHRASE}:${chatId}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(chatId),
      iterations: ENCRYPTION_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptChatPayload(chatId, payload) {
  const key = await deriveChatKey(chatId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedPayload = textEncoder.encode(JSON.stringify(payload));
  const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedPayload);

  return {
    version: 1,
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(encryptedBuffer))
  };
}

export async function decryptChatPayload(chatId, envelope) {
  if (!envelope || !envelope.ciphertext || !envelope.iv) {
    return null;
  }

  try {
    const key = await deriveChatKey(chatId);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(envelope.iv) },
      key,
      new Uint8Array(envelope.ciphertext)
    );
    return JSON.parse(textDecoder.decode(decryptedBuffer));
  } catch {
    return null;
  }
}
