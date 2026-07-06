import {
  appId,
  auth,
  db,
  messaging,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
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
  onMessage,
  encryptChatPayload,
  decryptChatPayload
} from './firebase.js';

const appContainer = document.getElementById('app-container');
const body = document.body;
const page = body.dataset.page || 'landing';
const currentPageFile = page === 'chat' ? 'Chat.html' : page === 'auth' ? 'auth.html' : 'index.html';

let currentUser = null;
let currentUserData = null;
let currentChatId = null;
let currentContact = null;
let unsubscribeUser = null;
let unsubscribeMessages = null;
let unsubscribeChat = null;
let unsubscribeTypingStatus = null;
let typingTimeout = null;
let currentChatReady = false;
let lastMessageDate = null;
let chatListeners = [];
let lastMessages = {};
const memberColors = {};
const colorPalette = ['#ef4444', '#f97316', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#6366f1', '#a855f7', '#d946ef', '#ec4899'];

const setAppHeight = () => {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
};

window.addEventListener('resize', setAppHeight);
setAppHeight();

function sanitizeHTML(str) {
  if (!str) return '';
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function normalizeContact(contact = {}) {
  return {
    ...contact,
    userId: contact.userId || '',
    isGroup: Boolean(contact.isGroup),
    profilePictureUrl: contact.profilePictureUrl || ''
  };
}

function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

async function ensureDirectChatDocExists(chatId, contact) {
  if (!chatId || !contact || contact.isGroup) return null;
  const chatDocRef = doc(db, 'chats', chatId);
  const chatSnapshot = await getDoc(chatDocRef);
  if (!chatSnapshot.exists()) {
    try {
        console.log("Current auth UID:", currentUser.uid);
        console.log("Contact object:", contact);
        console.log("Members being stored:", [currentUser.uid, contact.userId]);

        await setDoc(chatDocRef, {
            members: [currentUser.uid, contact.userId],
            isGroup: false
        });

        console.log("✅ Chat document created");
    } catch (e) {
        console.error("❌ setDoc failed:", e);
    }
  }
  return chatDocRef;
}

function isSystemBotUser(userId) {
  return userId === 'connectsphere_bot';
}

function getFormattedDate(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function getMemberColor(userId) {
  if (!memberColors[userId]) {
    memberColors[userId] = colorPalette[Object.keys(memberColors).length % colorPalette.length];
  }
  return memberColors[userId];
}

function getFallbackUsername(user) {
  if (user?.displayName) return user.displayName;
  if (user?.email) return user.email.split('@')[0];
  return 'User';
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadImageToImgbb(file) {
  const imageBase64 = await fileToBase64(file);
  const formData = new FormData();
  formData.append('key', '77f70e5b6f0a13e26c825448b73e94a4');
  formData.append('image', imageBase64);
  const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`Network error: ${response.statusText}`);
  const result = await response.json();
  if (!result.success) {
    throw new Error(result.data?.error?.message || 'Unknown upload error');
  }
  return result.data.url;
}

function setPageTitle(title) {
  document.title = `ConnectSphere | ${title}`;
}

function navigate(pageName) {
  if (unsubscribeUser) unsubscribeUser();
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeChat) unsubscribeChat();
  if (unsubscribeTypingStatus) unsubscribeTypingStatus();
  chatListeners.forEach(unsub => unsub());
  chatListeners = [];

  body.dataset.page = pageName;
  body.className = '';
  body.classList.add('text-gray-900');
  if (pageName === 'chat') body.classList.add('bg-white');
  if (pageName === 'auth') body.classList.add('bg-gray-100');
  if (pageName === 'landing') body.classList.add('bg-white');

  if (pageName === 'landing') {
    setPageTitle('Landing');
    renderLandingPage();
  } else if (pageName === 'auth') {
    setPageTitle('Auth');
    renderAuthPage();
  } else if (pageName === 'chat') {
    setPageTitle('Chat');
    renderChatPage();
  } else {
    renderLandingPage();
  }
}

function renderLoadingPage() {
  appContainer.innerHTML = `
    <div class="flex flex-col items-center justify-center h-full min-h-[var(--app-height)] bg-gray-50">
      <svg class="h-12 w-auto text-indigo-600 mb-4 animate-pulse" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      <h1 class="text-2xl font-bold text-gray-900">ConnectSphere</h1>
      <p class="mt-2 text-gray-600">Connecting...</p>
    </div>
  `;
}

function renderLandingPage() {
  appContainer.innerHTML = `
    <div class="page-shell mobile-full-height bg-white overflow-y-auto">
      <div class="bg-gradient-animation landing-hero-grid">
        <header class="absolute inset-x-0 top-0 z-50">
          <nav class="flex items-center justify-between p-6 lg:px-8" aria-label="Global">
            <div class="flex lg:flex-1">
              <a href="index.html" class="-m-1.5 p-1.5 flex items-center space-x-2">
                <svg class="h-8 w-auto text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span class="text-xl font-bold text-gray-900">ConnectSphere</span>
              </a>
            </div>
            <div class="lg:flex lg:flex-1 lg:justify-end">
              <a href="auth.html" class="text-sm font-semibold leading-6 text-gray-900">Log in <span aria-hidden="true">&rarr;</span></a>
            </div>
          </nav>
        </header>
        <main class="relative isolate px-6 pt-20 lg:px-8">
          <div class="mx-auto max-w-6xl py-24 sm:py-32 lg:py-40">
            <div class="grid gap-16 lg:grid-cols-[1.2fr_0.8fr] items-center">
              <div class="text-left">
                <span class="inline-flex items-center rounded-full border border-indigo-200 bg-white/80 px-4 py-2 text-sm font-medium text-indigo-700 soft-shadow">Private messaging, redesigned</span>
                <h1 class="mt-6 text-5xl font-extrabold tracking-tight text-gray-900 sm:text-7xl">Chatting, redefined.</h1>
                <p class="mt-6 max-w-2xl text-lg leading-8 text-gray-700">A fast, secure, and cleaner messaging experience for one-to-one chats and groups, with encrypted message storage by default.</p>
                <div class="mt-10 flex items-center gap-x-4">
                  <a href="auth.html" class="rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500">Get started</a>
                  <a href="#features" class="rounded-full border border-gray-300 bg-white/70 px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-white">See features</a>
                </div>
              </div>
              <div class="surface-card rounded-[2rem] p-5 sm:p-6">
                <div class="rounded-[1.5rem] bg-slate-950 p-5 text-white">
                  <div class="flex items-center justify-between text-xs text-slate-300">
                    <span>Encrypted chat</span>
                    <span>Live preview</span>
                  </div>
                  <div class="mt-5 space-y-3">
                    <div class="max-w-[80%] rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 text-sm">Messages are encrypted before they are written to Firebase.</div>
                    <div class="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-indigo-500 px-4 py-3 text-sm text-white">Separate pages keep the app easier to maintain.</div>
                  </div>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div class="rounded-2xl bg-white px-4 py-4 border border-slate-200">
                    <div class="font-semibold text-slate-900">Fast setup</div>
                    <div class="mt-1 text-slate-600">Landing, auth, and chat are split into focused pages.</div>
                  </div>
                  <div class="rounded-2xl bg-white px-4 py-4 border border-slate-200">
                    <div class="font-semibold text-slate-900">Modern UI</div>
                    <div class="mt-1 text-slate-600">Shared CSS drives the same visual language everywhere.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
      <section id="features" class="py-20 bg-white">
        <div class="mx-auto max-w-6xl px-6">
          <div class="grid gap-6 md:grid-cols-3">
            <div class="surface-card rounded-3xl p-8">
              <h3 class="text-xl font-bold mb-2">Real-time chat</h3>
              <p class="text-gray-600">Instant message delivery with a cleaner conversation layout.</p>
            </div>
            <div class="surface-card rounded-3xl p-8">
              <h3 class="text-xl font-bold mb-2">Group conversations</h3>
              <p class="text-gray-600">Create groups and manage members from the chat surface.</p>
            </div>
            <div class="surface-card rounded-3xl p-8">
              <h3 class="text-xl font-bold mb-2">Encrypted storage</h3>
              <p class="text-gray-600">Text and image references are encrypted before being stored in Firestore.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderAuthPage() {
  appContainer.innerHTML = `
    <div class="mobile-full-height flex items-center justify-center px-4 py-10 bg-transparent">
      <div class="w-full max-w-md auth-panel rounded-[2rem] p-6 sm:p-8">
        <div class="text-center">
          <a href="index.html" class="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600">
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-indigo-600"></span>
            ConnectSphere
          </a>
          <h2 id="auth-title" class="mt-6 text-3xl font-extrabold tracking-tight text-gray-900">Create your account</h2>
          <p class="mt-2 text-sm text-gray-600">Or <button id="switch-auth-mode" class="font-medium text-indigo-600 hover:text-indigo-500">sign in to your existing account</button></p>
        </div>
        <form id="auth-form" class="mt-8 space-y-5" action="#" method="POST">
          <div class="space-y-4">
            <div id="username-field" class="relative">
              <span class="absolute inset-y-0 left-0 flex items-center pl-3"><svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" /></svg></span>
              <input id="username" name="username" type="text" required class="block w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 pl-10 text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100" placeholder="Username">
            </div>
            <div class="relative">
              <span class="absolute inset-y-0 left-0 flex items-center pl-3"><svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 2l7.997 3.884A2 2 0 0019 7.616V16a2 2 0 01-2 2H3a2 2 0 01-2-2V7.616a2 2 0 001.003-1.732zM10 12a2 2 0 100-4 2 2 0 000 4z" /><path d="M10 15a5 5 0 100-10 5 5 0 000 10z" /></svg></span>
              <input id="email-address" name="email" type="email" autocomplete="email" required class="block w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 pl-10 text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100" placeholder="Email address">
            </div>
            <div class="relative">
              <span class="absolute inset-y-0 left-0 flex items-center pl-3"><svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" /></svg></span>
              <input id="password" name="password" type="password" autocomplete="current-password" required class="block w-full rounded-2xl border border-gray-200 bg-white px-3 py-3 pl-10 text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100" placeholder="Password">
            </div>
            <div id="terms-div" class="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 text-left text-xs">
              <button type="button" id="terms-toggle" class="flex w-full items-center justify-between font-bold text-gray-900">
                <span>Terms & Conditions and Privacy Policy</span>
                <svg id="terms-arrow" class="h-4 w-4 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </button>
              <div id="terms-content" class="mt-3 hidden text-gray-600">
                <h3 class="font-bold mb-2 text-gray-900">Terms & Conditions</h3>
                <p class="mb-3">By creating an account, you agree to abide by the rules of ConnectSphere. You will not use the service for illegal activities, harassment, or spamming. You understand that your data may be stored securely and used to provide the service. We are not responsible for user-generated content. The creator of this website is Sarthak Mitra.</p>
                <h3 class="font-bold mb-2 text-gray-900">Privacy Policy</h3>
                <p>Your username, profile picture, contacts, and message history are stored securely to power the app. We do not sell your data to third parties. You may request deletion of your account at any time.</p>
              </div>
              <label class="mt-3 flex items-center gap-2 text-gray-700">
                <input type="checkbox" id="terms-checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" required>
                <span>I agree to the Terms & Conditions and Privacy Policy</span>
              </label>
            </div>
          </div>
          <button type="submit" id="auth-submit-btn" class="w-full rounded-2xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500">Sign up</button>
        </form>
        <p id="auth-error" class="mt-4 text-center text-sm text-red-600"></p>
      </div>
    </div>
  `;
  setupAuthForm();
  const termsToggle = document.getElementById('terms-toggle');
  const termsContent = document.getElementById('terms-content');
  const termsArrow = document.getElementById('terms-arrow');
  if (termsToggle && termsContent && termsArrow) {
    termsToggle.addEventListener('click', () => {
      const isOpen = !termsContent.classList.contains('hidden');
      termsContent.classList.toggle('hidden', isOpen);
      termsArrow.style.transform = isOpen ? '' : 'rotate(180deg)';
    });
  }
}

function renderChatPage() {
  appContainer.innerHTML = `
    <div class="page-shell h-[var(--app-height)] w-full overflow-hidden flex bg-white relative">
      <div id="contacts-panel" class="w-full md:w-80 lg:w-96 flex flex-col min-h-0 shrink-0 border-r border-gray-200 transition-transform duration-300 ease-in-out md:translate-x-0 bg-white">
        <div class="p-3 sm:p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div class="flex items-center overflow-hidden">
            <img id="user-profile-pic" src="https://placehold.co/40x40/E2E8F0/4A5568?text=U" class="w-10 h-10 rounded-full mr-3 object-cover flex-shrink-0">
            <div class="overflow-hidden">
              <p id="user-username" class="font-semibold text-gray-900 truncate">Loading...</p>
              <p class="text-xs text-gray-500">UID: <span id="user-uid">...</span></p>
            </div>
          </div>
          <div class="flex items-center space-x-1">
            <button id="create-group-btn" class="p-2 rounded-full hover:bg-gray-100">
              <svg class="w-6 h-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" /></svg>
            </button>
            <button id="settings-btn" class="p-2 rounded-full hover:bg-gray-100">
              <svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
          </div>
        </div>
        <div class="p-2 sm:p-4 border-b border-gray-200 flex-shrink-0">
          <div class="relative">
            <span class="absolute inset-y-0 left-0 flex items-center pl-3"><svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg></span>
            <input id="search-contacts" type="text" placeholder="Search contacts..." class="w-full bg-gray-100 rounded-full py-2 pl-10 pr-4 focus:outline-none">
          </div>
        </div>
        <div class="p-2 sm:p-4 border-b border-gray-200 flex-shrink-0">
          <button id="add-contact-btn" class="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition duration-200">Add Contact</button>
        </div>
        <div id="contacts-list" class="flex-1 min-h-0 overflow-y-auto"></div>
      </div>
      <div id="chat-panel" class="w-full flex-1 min-w-0 min-h-0 flex flex-col bg-gray-50 absolute md:relative top-0 left-0 h-full transition-transform duration-300 ease-in-out translate-x-full md:translate-x-0">
        <div id="chat-placeholder" class="flex flex-col items-center justify-center h-full text-center p-4">
          <svg class="w-24 h-24 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <h2 class="mt-4 text-2xl font-semibold text-gray-800">Welcome to ConnectSphere</h2>
          <p class="text-gray-500">Select a contact to start chatting.</p>
        </div>
        <div id="chat-area" class="hidden flex-col h-full">
          <div class="p-3 sm:p-4 border-b border-gray-200 flex items-center justify-between bg-white flex-shrink-0">
            <div class="flex items-center min-w-0">
              <button id="back-to-contacts-btn" class="md:hidden mr-2 p-2 rounded-full hover:bg-gray-200">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
              </button>
              <img id="chat-contact-pic" src="https://placehold.co/40x40/E2E8F0/4A5568?text=C" class="w-10 h-10 rounded-full mr-3 object-cover flex-shrink-0">
              <div class="min-w-0">
                <p id="chat-contact-name" class="font-semibold text-gray-900 truncate">Contact Name</p>
                <p id="typing-indicator" class="text-xs text-green-500 h-4"></p>
              </div>
            </div>
            <div id="group-admin-controls" class="hidden flex-shrink-0 ml-2">
              <button id="manage-group-btn" class="px-3 py-1.5 bg-gray-200 text-gray-800 text-sm font-semibold rounded-md hover:bg-gray-300">Manage</button>
            </div>
          </div>
          <div id="messages-container" class="flex-1 min-h-0 p-2 sm:p-4 overflow-y-auto space-y-2"></div>
          <div class="p-2 sm:p-4 bg-white border-t border-gray-200 flex-shrink-0">
            <form id="message-form" class="flex items-center space-x-2 sm:space-x-3">
              <button type="button" id="attach-file-btn" class="p-2 rounded-full hover:bg-gray-200">
                <svg class="w-6 h-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>
              </button>
              <input id="message-input" type="text" placeholder="Type a message..." class="flex-grow bg-gray-100 rounded-full py-2 px-4 focus:outline-none">
              <button type="submit" id="send-btn" class="p-2 bg-indigo-300 text-white rounded-full cursor-not-allowed" disabled>
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
  setupChatPage();
}

function showModal(title, content, onConfirm, confirmText = 'Confirm', cancelText = 'Cancel') {
  const modalId = `modal-${Date.now()}`;
  let buttonsHTML = `
    <button id="confirm-btn" class="px-4 py-2 bg-indigo-600 text-white text-base font-medium rounded-md w-auto shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">${confirmText}</button>
    <button id="cancel-btn" class="px-4 py-2 bg-gray-200 text-gray-800 text-base font-medium rounded-md w-auto shadow-sm hover:bg-gray-300 focus:outline-none">${cancelText}</button>
  `;
  if (Array.isArray(onConfirm)) {
    buttonsHTML = `
      <button id="delete-for-me-btn" class="px-4 py-2 bg-yellow-500 text-white text-base font-medium rounded-md w-auto shadow-sm hover:bg-yellow-600 focus:outline-none">${confirmText}</button>
      <button id="delete-for-everyone-btn" class="px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md w-auto shadow-sm hover:bg-red-700 focus:outline-none">${cancelText}</button>
      <button id="cancel-delete-btn" class="px-4 py-2 bg-gray-200 text-gray-800 text-base font-medium rounded-md w-auto shadow-sm hover:bg-gray-300 focus:outline-none">Cancel</button>
    `;
  }

  const modalHTML = `
    <div id="${modalId}" class="fixed inset-0 bg-gray-600 bg-opacity-50 modal-backdrop overflow-y-auto h-full w-full z-50 flex items-center justify-center px-4">
      <div class="relative mx-auto p-4 sm:p-5 border w-full max-w-md shadow-lg rounded-md bg-white">
        <div class="mt-3 text-center">
          <h3 class="text-lg leading-6 font-medium text-gray-900">${title}</h3>
          <div class="mt-2 px-4 sm:px-7 py-3">${content}</div>
          <div id="modal-buttons" class="items-center px-4 py-3 space-x-2">${buttonsHTML}</div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  const modalElement = document.getElementById(modalId);
  const closeModal = () => modalElement.remove();

  if (Array.isArray(onConfirm)) {
    const [deleteForMeCb, deleteForEveryoneCb, showDeleteForEveryone] = onConfirm;
    modalElement.querySelector('#delete-for-me-btn').addEventListener('click', () => { deleteForMeCb(); closeModal(); });
    const deleteForEveryoneBtn = modalElement.querySelector('#delete-for-everyone-btn');
    if (showDeleteForEveryone) {
      deleteForEveryoneBtn.addEventListener('click', () => { deleteForEveryoneCb(); closeModal(); });
    } else {
      deleteForEveryoneBtn.style.display = 'none';
    }
    modalElement.querySelector('#cancel-delete-btn').addEventListener('click', closeModal);
  } else {
    modalElement.querySelector('#confirm-btn').addEventListener('click', async () => {
      const confirmBtn = modalElement.querySelector('#confirm-btn');
      confirmBtn.disabled = true;
      const success = await onConfirm();
      if (success) closeModal();
      confirmBtn.disabled = false;
    });
    modalElement.querySelector('#cancel-btn').addEventListener('click', closeModal);
  }
}

async function setupFirebaseMessaging() {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const vapidKey = 'BIDvpY18PX6oCjKnSJruCodvahMleeNbEkUM0LPAn-eWCDFXTbFx6_s014b9_jwshkDsjzuHsaeZbyoDEcfqbu4';
      const swUrl = new URL('firebase-messaging-sw.js', window.location.href);
      const serviceWorkerRegistration = await navigator.serviceWorker.register(swUrl);
      const currentToken = await getToken(messaging, { vapidKey, serviceWorkerRegistration });
      if (currentToken) {
        await saveFcmToken(currentToken);
      }
    }
  } catch (err) {
    console.error('An error occurred while setting up notifications.', err);
  }
}

async function saveFcmToken(token) {
  if (!currentUser) return;
  await updateDoc(doc(db, 'users', currentUser.uid), { fcmTokens: arrayUnion(token) });
}

onMessage(messaging, payload => {
  if (!payload?.notification) return;
  showModal(
    `New Message: ${payload.notification.title || 'Notification'}`,
    `<p class="text-sm text-gray-500">${sanitizeHTML(payload.notification.body || '')}</p>`,
    () => true,
    'Dismiss'
  );
});

function setupAuthForm() {
  let isLoginMode = false;
  const form = document.getElementById('auth-form');
  const usernameField = document.getElementById('username-field');
  const authTitle = document.getElementById('auth-title');
  const switchBtn = document.getElementById('switch-auth-mode');
  const submitBtn = document.getElementById('auth-submit-btn');
  const errorP = document.getElementById('auth-error');

  const toggleMode = () => {
    isLoginMode = !isLoginMode;
    usernameField.style.display = isLoginMode ? 'none' : 'block';
    authTitle.textContent = isLoginMode ? 'Sign in to your account' : 'Create your account';
    switchBtn.textContent = isLoginMode ? 'create a new account' : 'sign in to your existing account';
    submitBtn.textContent = isLoginMode ? 'Sign in' : 'Sign up';
    errorP.textContent = '';
  };

  switchBtn.addEventListener('click', toggleMode);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
    errorP.textContent = '';

    const email = form['email-address'] ? form['email-address'].value.trim() : '';
    const password = form['password'] ? form['password'].value : '';
    if (!email || !password) {
      errorP.textContent = 'Email and password are required.';
      submitBtn.disabled = false;
      submitBtn.textContent = isLoginMode ? 'Sign in' : 'Sign up';
      return;
    }

    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const username = form.username.value;
        if (!username) throw new Error('Username is required.');
        if (username.length > 20) throw new Error('Username must be 20 characters or less.');

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const uid = await generateUniqueFiveDigitId();

        await setDoc(doc(db, 'users', user.uid), {
          username,
          uid,
          profilePictureUrl: '',
          contacts: [],
          unreadChats: []
        });

        await sendWelcomeMessage(user.uid);
      }
    } catch (error) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorP.textContent = 'This email address is already in use.';
          break;
        case 'auth/weak-password':
          errorP.textContent = 'Password should be at least 6 characters.';
          break;
        case 'auth/invalid-email':
          errorP.textContent = 'Please enter a valid email address.';
          break;
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          errorP.textContent = 'Invalid email or password.';
          break;
        default:
          errorP.textContent = error.message || 'An unknown error occurred. Please try again.';
          console.error('Auth error:', error);
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isLoginMode ? 'Sign in' : 'Sign up';
    }
  });
}

function setupChatPage() {
  if (!currentUser) return;
  currentChatReady = false;

  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  let currentContactsJson = '';

  const userDocRef = doc(db, 'users', currentUser.uid);
  currentUserData = currentUserData || {
    username: getFallbackUsername(currentUser),
    uid: '...',
    profilePictureUrl: '',
    contacts: [],
    unreadChats: []
  };
  updateUIWithUserData(currentUserData);

  getDoc(userDocRef).then(async snapshot => {
    if (!snapshot.exists()) {
      const generatedUid = await generateUniqueFiveDigitId();
      const bootstrapProfile = {
        username: getFallbackUsername(currentUser),
        uid: generatedUid,
        profilePictureUrl: '',
        contacts: [],
        unreadChats: []
      };
      await setDoc(userDocRef, bootstrapProfile);
      currentUserData = { id: currentUser.uid, ...bootstrapProfile };
      updateUIWithUserData(currentUserData);
    } else if (!snapshot.data().uid) {
      const generatedUid = await generateUniqueFiveDigitId();
      await updateDoc(userDocRef, { uid: generatedUid });
    }
  }).catch(error => {
    console.error('Failed to bootstrap user profile:', error);
  });

  unsubscribeUser = onSnapshot(userDocRef, snapshot => {
    if (snapshot.exists()) {
      currentUserData = { id: snapshot.id, ...snapshot.data() };
      if (!currentUserData.uid) {
        void (async () => {
          const generatedUid = await generateUniqueFiveDigitId();
          await updateDoc(userDocRef, { uid: generatedUid });
        })();
      }
      updateUIWithUserData(currentUserData);
      const newContactsJson = JSON.stringify(currentUserData.contacts || []);
      if (newContactsJson !== currentContactsJson) {
        currentContactsJson = newContactsJson;
        listenForNewMessages(currentUserData.contacts || []);
      }
      sendBtn.disabled = false;
      sendBtn.classList.remove('bg-indigo-300', 'cursor-not-allowed');
      sendBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
    } else if (currentUserData) {
      updateUIWithUserData(currentUserData);
    }
  });

  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  document.getElementById('create-group-btn').addEventListener('click', openCreateGroupModal);
  document.getElementById('add-contact-btn').addEventListener('click', openAddContactModal);
  document.getElementById('message-form').addEventListener('submit', handleSendMessage);

  const chatImageUpload = document.getElementById('chat-image-upload');
  document.getElementById('attach-file-btn').addEventListener('click', () => {
    if (currentChatId) {
      chatImageUpload.click();
    } else {
      showModal('No Chat Selected', '<p class="text-sm text-gray-500">Please select a chat before sending an image.</p>', () => true, 'OK');
    }
  });
  chatImageUpload?.addEventListener('change', handleImageUploadAndSend);

  document.getElementById('back-to-contacts-btn').addEventListener('click', closeChatOnMobile);
  document.getElementById('search-contacts').addEventListener('input', e => {
    renderContactsList(currentUserData.contacts || [], currentUserData.unreadChats || [], e.target.value);
  });

  messageInput.addEventListener('input', handleTyping);
}

function listenForNewMessages(contacts) {
  chatListeners.forEach(unsub => unsub());
  chatListeners = [];

  contacts.forEach(contact => {
    void (async () => {
      const normalized = normalizeContact(contact);
      const chatId = normalized.isGroup ? normalized.groupId : getChatId(currentUser.uid, normalized.userId);
      const chatDocRef = doc(db, 'chats', chatId);
      const chatSnapshot = await getDoc(chatDocRef);

      if (!chatSnapshot.exists()) {
        lastMessages[chatId] = null;
        if (currentUserData) {
          renderContactsList(currentUserData.contacts || [], currentUserData.unreadChats || []);
        }
        return;
      }

      const chatData = chatSnapshot.data();
      const members = chatData.members || [];
      if (!members.includes(currentUser.uid)) {
        return;
      }

      const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp', 'desc'), limit(1));
      const unsub = onSnapshot(q, snapshot => {
        void (async () => {
          if (!snapshot.empty) {
            const lastMsg = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
            lastMessages[chatId] = await decryptMessageForDisplay(chatId, lastMsg);
          } else {
            lastMessages[chatId] = null;
          }
          if (currentUserData) {
            renderContactsList(currentUserData.contacts || [], currentUserData.unreadChats || []);
          }
        })();
      }, error => {
        console.error('Contact preview listener error:', error);
      });
      chatListeners.push(unsub);
    })();
  });
}

async function handleTyping() {
  if (!currentChatReady || !currentChatId || (currentContact && currentContact.isGroup)) return;
  await ensureDirectChatDocExists(currentChatId, currentContact);
  const chatDocRef = doc(db, 'chats', currentChatId);
  await setDoc(chatDocRef, { typing: { [currentUser.uid]: true } }, { merge: true });
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(async () => {
    await setDoc(chatDocRef, { typing: { [currentUser.uid]: false } }, { merge: true });
  }, 1500);
}

async function handleImageUploadAndSend(e) {
  const file = e.target.files[0];
  if (!file || !currentChatId) return;
  e.target.value = null;

  if (!file.type.startsWith('image/')) {
    showModal('Unsupported file', '<p class="text-sm text-gray-500">Please choose an image file.</p>', () => true, 'OK');
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    showModal('Image too large', '<p class="text-sm text-gray-500">Please choose an image under 4 MB.</p>', () => true, 'OK');
    return;
  }

  const tempId = `temp_${Date.now()}`;
  renderMessage({ id: tempId, type: 'text', text: 'Uploading image...', senderId: currentUser.uid });

  try {
    const imageUrl = await uploadImageToImgbb(file);
    document.getElementById(tempId)?.remove();
    await sendMessage(imageUrl, 'image');
  } catch (error) {
    console.error('Image send error:', error);
    document.getElementById(tempId)?.remove();
    renderMessage({
      id: `error_${Date.now()}`,
      type: 'text',
      text: '⚠️ Image failed to send. Please try again.',
      senderId: currentUser.uid
    });
  }
}

async function generateUniqueFiveDigitId() {
  let uid;
  let isUnique = false;
  while (!isUnique) {
    uid = Math.floor(10000 + Math.random() * 90000).toString();
    const q = query(collection(db, 'users'), where('uid', '==', uid));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) isUnique = true;
  }
  return uid;
}

async function sendWelcomeMessage(userId) {
  const botContact = { name: 'ConnectSphere Bot', userId: 'connectsphere_bot', profilePictureUrl: 'https://placehold.co/40x40/93C5FD/1E40AF?text=B' };
  const userDocRef = doc(db, 'users', userId);
  await updateDoc(userDocRef, { contacts: arrayUnion(botContact) });
  const chatId = getChatId(userId, botContact.userId);
  await sendMessageToChat(chatId, userId, botContact.userId, {
    type: 'text',
    text: 'Welcome to ConnectSphere! Your unique UID is shown in the top left. Share it with friends to connect. You can add new contacts using their UID. Enjoy your stay!',
    senderId: botContact.userId,
    senderName: 'ConnectSphere Bot',
    timestamp: serverTimestamp(),
    isRead: true,
    deletedFor: []
  });
}

function updateUIWithUserData(data) {
  const safeUsername = data?.username || getFallbackUsername(currentUser);
  const safeUid = data?.uid || '...';
  document.getElementById('user-username').textContent = sanitizeHTML(safeUsername);
  document.getElementById('user-uid').textContent = sanitizeHTML(safeUid);
  const profilePic = document.getElementById('user-profile-pic');
  if (data?.profilePictureUrl) {
    profilePic.src = data.profilePictureUrl;
  } else {
    profilePic.src = `https://placehold.co/40x40/E2E8F0/4A5568?text=${sanitizeHTML(safeUsername.charAt(0).toUpperCase())}`;
  }
  renderContactsList(data?.contacts || [], data?.unreadChats || []);
}

function renderContactsList(contacts, unreadChats, searchTerm = '') {
  const listElement = document.getElementById('contacts-list');
  listElement.innerHTML = '';

  const filteredContacts = (contacts || []).filter(contact => {
    const normalized = normalizeContact(contact);
    const name = normalized.isGroup ? normalized.groupName : normalized.name;
    return String(name || '').toLowerCase().includes(searchTerm.toLowerCase());
  });

  if (filteredContacts.length === 0) {
    listElement.innerHTML = `<p class="p-4 text-center text-sm text-gray-500">No Contacts</p>`;
    return;
  }

  filteredContacts.sort((a, b) => {
    const aContact = normalizeContact(a);
    const bContact = normalizeContact(b);
    const aChatId = aContact.isGroup ? aContact.groupId : getChatId(currentUser.uid, aContact.userId);
    const bChatId = bContact.isGroup ? bContact.groupId : getChatId(currentUser.uid, bContact.userId);
    const aIsUnread = unreadChats.includes(aChatId);
    const bIsUnread = unreadChats.includes(bChatId);
    if (aIsUnread && !bIsUnread) return -1;
    if (!aIsUnread && bIsUnread) return 1;
    const aLastMessage = lastMessages[aChatId];
    const bLastMessage = lastMessages[bChatId];
    if (aLastMessage?.timestamp && bLastMessage?.timestamp) {
      return bLastMessage.timestamp.toMillis() - aLastMessage.timestamp.toMillis();
    }
    return 0;
  });

  filteredContacts.forEach(contactRaw => {
    const contact = normalizeContact(contactRaw);
    const contactEl = document.createElement('div');
    const isGroup = contact.isGroup;
    const chatId = isGroup ? contact.groupId : getChatId(currentUser.uid, contact.userId);
    const isUnread = unreadChats.includes(chatId);
    contactEl.className = 'contact-item flex items-center p-3 sm:p-4 hover:bg-gray-100 cursor-pointer border-b border-gray-200';

    let picUrl = '';
    if (contact.profilePictureUrl) {
      picUrl = `${contact.profilePictureUrl}?t=${Date.now()}`;
    } else if (isGroup) {
      picUrl = 'https://placehold.co/40x40/A5B4FC/312E81?text=G';
    } else {
      picUrl = `https://placehold.co/40x40/A5B4FC/312E81?text=${sanitizeHTML(contact.name.charAt(0).toUpperCase())}`;
    }
    const name = isGroup ? contact.groupName : contact.name;

    let previewHTML = '';
    const lastMessage = lastMessages[chatId];
    if (lastMessage) {
      let prefix = '';
      if (lastMessage.senderId === currentUser.uid) {
        prefix = 'You: ';
      } else if (isGroup) {
        prefix = `${sanitizeHTML(lastMessage.senderName)}: `;
      }
      const content = lastMessage.type === 'image' ? 'Sent an image' : sanitizeHTML(lastMessage.text || '');
      previewHTML = `<p class="text-sm truncate ${isUnread ? 'font-bold text-gray-900' : 'text-gray-500'}">${prefix}${content}</p>`;
    }

    contactEl.innerHTML = `
      <img src="${picUrl}" class="w-10 h-10 rounded-full mr-3 object-cover">
      <div class="flex-grow overflow-hidden">
        <p class="font-semibold text-gray-900 truncate">${sanitizeHTML(name)}</p>
        ${previewHTML}
      </div>
      ${!isGroup ? `<div class="contact-actions hidden md:flex items-center space-x-1">
        <button class="edit-contact-btn p-2 rounded-full hover:bg-gray-200"><svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L14.732 3.732z"></path></svg></button>
        <button class="delete-contact-btn p-2 rounded-full hover:bg-gray-200"><svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
      </div>` : ''}
    `;
    contactEl.addEventListener('click', () => openChat(contact));

    let pressTimer;
    contactEl.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => openContactActionsModal(contact), 500);
    }, { passive: true });
    contactEl.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
    contactEl.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });

    if (!isGroup) {
      const editBtn = contactEl.querySelector('.edit-contact-btn');
      const deleteBtn = contactEl.querySelector('.delete-contact-btn');
      editBtn?.addEventListener('click', e => {
        e.stopPropagation();
        openEditContactModal(contact);
      });
      deleteBtn?.addEventListener('click', e => {
        e.stopPropagation();
        openDeleteContactModal(contact);
      });
    }
    listElement.appendChild(contactEl);
  });
}

async function openChat(contactRaw) {
  const contact = normalizeContact(contactRaw);
  currentContact = contact;
  currentChatReady = false;
  lastMessageDate = null;
  document.getElementById('contacts-panel').classList.add('-translate-x-full');
  document.getElementById('chat-panel').classList.remove('translate-x-full');
  document.getElementById('chat-placeholder').classList.add('hidden');
  const chatArea = document.getElementById('chat-area');
  chatArea.classList.remove('hidden');
  chatArea.classList.add('flex');

  const isGroup = contact.isGroup;
  const name = isGroup ? contact.groupName : contact.name;
  let picUrl = '';
  if (contact.profilePictureUrl) {
    picUrl = `${contact.profilePictureUrl}?t=${Date.now()}`;
  } else if (isGroup) {
    picUrl = 'https://placehold.co/40x40/A5B4FC/312E81?text=G';
  } else {
    picUrl = `https://placehold.co/40x40/A5B4FC/312E81?text=${sanitizeHTML(contact.name.charAt(0).toUpperCase())}`;
  }
  document.getElementById('chat-contact-name').textContent = sanitizeHTML(name);
  document.getElementById('chat-contact-pic').src = picUrl;
  currentChatId = isGroup ? contact.groupId : getChatId(currentUser.uid, contact.userId);

  await updateDoc(doc(db, 'users', currentUser.uid), { unreadChats: arrayRemove(currentChatId) });

  if (!isGroup) {
    await ensureDirectChatDocExists(currentChatId, contact);
  }

  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeTypingStatus) unsubscribeTypingStatus();
  if (unsubscribeChat) unsubscribeChat();

  const messagesContainer = document.getElementById('messages-container');
  messagesContainer.innerHTML = '';
  bootstrapChatMessageListener(currentChatId, messagesContainer, isGroup);

  const adminControls = document.getElementById('group-admin-controls');
  const typingIndicator = document.getElementById('typing-indicator');

  if (isGroup) {
    typingIndicator.textContent = '';
    const chatDocRef = doc(db, 'chats', currentChatId);
    unsubscribeChat = onSnapshot(chatDocRef, snapshot => {
      if (snapshot.exists()) {
        const groupData = { groupId: snapshot.id, ...snapshot.data() };
        const isAdmin = groupData.admins && groupData.admins.includes(currentUser.uid);
        adminControls.classList.toggle('hidden', !isAdmin);
        if (isAdmin) {
          document.getElementById('manage-group-btn').onclick = () => openManageGroupModal(groupData);
        }
      }
    });
  } else {
    adminControls.classList.add('hidden');
    const chatDocRef = doc(db, 'chats', currentChatId);
    unsubscribeTypingStatus = onSnapshot(chatDocRef, snapshot => {
      if (snapshot.exists() && snapshot.data().typing && snapshot.data().typing[contact.userId]) {
        typingIndicator.textContent = 'typing...';
      } else {
        typingIndicator.textContent = '';
      }
    });
  }

  currentChatReady = true;
}

async function markMessagesAsRead() {
  if (!currentChatId || !currentContact || currentContact.isGroup) return;
  const unreadQuery = query(
    collection(db, 'chats', currentChatId, 'messages'),
    where('senderId', '==', currentContact.userId),
    where('isRead', '==', false)
  );
  const unreadSnapshot = await getDocs(unreadQuery);
  if (unreadSnapshot.empty) return;
  const batch = writeBatch(db);
  unreadSnapshot.forEach(messageDoc => batch.update(messageDoc.ref, { isRead: true }));
  await batch.commit();
}

function closeChatOnMobile() {
  document.getElementById('contacts-panel').classList.remove('-translate-x-full');
  document.getElementById('chat-panel').classList.add('translate-x-full');
  currentChatId = null;
  currentContact = null;
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeChat) unsubscribeChat();
  if (unsubscribeTypingStatus) unsubscribeTypingStatus();
}

function renderMessage(data) {
  const messagesContainer = document.getElementById('messages-container');

  // ---------- Handle Timestamp Safely ----------
  let messageDate = null;

  if (data.timestamp) {
    try {
      if (typeof data.timestamp.toDate === "function") {
        messageDate = data.timestamp.toDate();
      } else if (data.timestamp instanceof Date) {
        messageDate = data.timestamp;
      } else if (data.timestamp.seconds !== undefined) {
        messageDate = new Date(data.timestamp.seconds * 1000);
      } else {
        messageDate = new Date(data.timestamp);
      }

      if (!isNaN(messageDate.getTime())) {
        if (
          !lastMessageDate ||
          messageDate.toDateString() !== lastMessageDate.toDateString()
        ) {
          const dateDivider = document.createElement("div");
          dateDivider.className = "text-center my-2";
          dateDivider.innerHTML = `
            <span class="bg-gray-200 text-xs text-gray-500 px-2 py-1 rounded-full">
              ${getFormattedDate(messageDate)}
            </span>
          `;
          messagesContainer.appendChild(dateDivider);
          lastMessageDate = messageDate;
        }
      }
    } catch (err) {
      console.error("Timestamp error:", err, data.timestamp);
    }
  }

  // ---------- Remove old message if exists ----------
  const existing = document.getElementById(data.id);
  if (existing) existing.remove();

  const isSent = data.senderId === currentUser.uid;

  const messageDiv = document.createElement("div");
  messageDiv.id = data.id;
  messageDiv.className = `message-container flex items-end ${
    isSent ? "justify-end" : "justify-start"
  }`;

  // ---------- Message Content ----------
  let contentHTML = "";

  if (data.type === "image") {
    contentHTML = `
      <div class="space-y-2">
        <div class="relative overflow-hidden rounded-2xl bg-slate-100 shadow-sm">
          <div data-message-placeholder="${data.id}" class="flex min-h-40 min-w-56 items-center justify-center px-6 py-10 text-sm text-slate-500">
            Loading image...
          </div>

          <a href="#" target="_blank" rel="noopener noreferrer" class="block">
            <img
              data-message-image="${data.id}"
              alt="Sent image"
              class="hidden max-h-80 w-auto max-w-xs object-cover">
          </a>
        </div>
      </div>
    `;
  } else if (data.type === "text" && data.text) {
    contentHTML = `
      <p class="text-sm text-black break-words">
        ${sanitizeHTML(data.text)}
      </p>
    `;
  } else if (data.encryptedPayload) {
    contentHTML = `
      <p class="text-sm text-gray-500 break-words">
        Encrypted message
      </p>
    `;
  } else {
    contentHTML = `
      <p class="text-sm text-black break-words">
        ${sanitizeHTML(data.text || "")}
      </p>
    `;
  }

  // ---------- Timestamp ----------
  let timestampHTML = "";

  if (messageDate) {
    const time = messageDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const ticks =
      isSent && !currentContact.isGroup
        ? `<span class="ticks ml-1 ${
            data.isRead ? "tick-seen" : "tick-delivered"
          }">${data.isRead ? "✓✓" : "✓"}</span>`
        : "";

    timestampHTML = `
      <p class="text-xs text-right mt-1 text-gray-500 flex items-center justify-end">
        ${time}${ticks}
      </p>
    `;
  }

  // ---------- Delete Button ----------
  const deleteButton = `
    <button class="delete-btn p-1"
      onclick="window.showDeleteOptions('${data.id}','${data.senderId}')">
      <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor"
        viewBox="0 0 24 24">
        <path stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16">
        </path>
      </svg>
    </button>
  `;

  // ---------- Group Sender Name ----------
  const senderNameHTML =
    currentContact.isGroup && !isSent
      ? `
        <p class="text-xs font-bold mb-1"
           style="color:${getMemberColor(data.senderId)}">
          ${sanitizeHTML(data.senderName || "Unknown User")}
        </p>
      `
      : "";

  // ---------- Build Bubble ----------
  messageDiv.innerHTML = `
    ${isSent ? deleteButton : ""}

    <div class="flex flex-col ${isSent ? "items-end" : "items-start"}">

      ${senderNameHTML}

      <div class="max-w-[80%] sm:max-w-xs lg:max-w-md px-3 py-2 rounded-xl ${
        isSent ? "chat-bubble-sent" : "chat-bubble-received"
      }">

        ${contentHTML}

        ${timestampHTML}

      </div>
    </div>

    ${!isSent ? deleteButton : ""}
  `;

  // ---------- Load Image ----------
  if (data.type === "image") {
    const imageElement = messageDiv.querySelector(
      `[data-message-image="${data.id}"]`
    );

    const placeholder = messageDiv.querySelector(
      `[data-message-placeholder="${data.id}"]`
    );

    if (imageElement) {
      const imageSource = data.imageUrl || "";

      const imageLink = imageElement.closest("a");
      if (imageLink) imageLink.href = imageSource;

      imageElement.addEventListener(
        "load",
        () => placeholder?.remove(),
        { once: true }
      );

      imageElement.addEventListener(
        "error",
        () => {
          if (placeholder) placeholder.textContent = "Image unavailable";
        },
        { once: true }
      );

      imageElement.src = imageSource;
      imageElement.classList.remove("hidden");
    }
  }

  // ---------- Long Press ----------
  let pressTimer;

  messageDiv.addEventListener(
    "touchstart",
    () => {
      pressTimer = setTimeout(() => {
        window.showDeleteOptions(data.id, data.senderId);
      }, 500);
    },
    { passive: true }
  );

  messageDiv.addEventListener(
    "touchend",
    () => clearTimeout(pressTimer),
    { passive: true }
  );

  messageDiv.addEventListener(
    "touchmove",
    () => clearTimeout(pressTimer),
    { passive: true }
  );

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

window.showDeleteOptions = (messageId, senderId) => {
  const isMyMessage = senderId === currentUser.uid;
  const deleteForMe = async () => {
    await updateDoc(doc(db, 'chats', currentChatId, 'messages', messageId), { deletedFor: arrayUnion(currentUser.uid) });
  };
  const deleteForEveryone = async () => {
    await deleteDoc(doc(db, 'chats', currentChatId, 'messages', messageId));
  };

  showModal('Delete Message', '<p class="text-sm text-gray-500">Choose an option:</p>', [deleteForMe, deleteForEveryone, isMyMessage], 'Delete for me', 'Delete for everyone');
};

async function encryptMessagePayload(chatId, messageData) {
  return encryptChatPayload(chatId, messageData);
}

async function sendMessageToChat(chatId, senderUid, recipientUid, messageData) {
  const chatDocRef = doc(db, 'chats', chatId);
  const chatDoc = await getDoc(chatDocRef);

  const members = chatDoc.exists()
    ? (chatDoc.data().members || [])
    : [senderUid, recipientUid];

  if (!chatDoc.exists()) {
    await setDoc(chatDocRef, {
      members,
      isGroup: false
    });
  }

  // DO NOT include timestamp in encrypted payload
  const payload = {
    type: messageData.type,
    text: messageData.text,
    imageUrl: messageData.imageUrl
  };

  const encryptedPayload = await encryptMessagePayload(chatId, payload);

  const storeData = {
    senderId: messageData.senderId,
    senderName: messageData.senderName,
    timestamp: serverTimestamp(),   // <-- stored separately
    type: messageData.type,
    isRead: false,
    deletedFor: [],
    encryptedPayload
  };

  await addDoc(collection(chatDocRef, "messages"), storeData);

  return storeData;
}

async function sendMessage(content, type = 'text') {
  if (!content || !currentChatId) return;

  const messageData = {
    type,
    senderId: currentUser.uid,
    senderName: currentUserData.username,
    timestamp: serverTimestamp(),
    isRead: false,
    deletedFor: []
  };

  if (type === 'text') {
    messageData.text = content;
  } else if (type === 'image') {
    messageData.imageUrl = content;
  }

  const chatDocRef = doc(db, 'chats', currentChatId);
  const chatDoc = await getDoc(chatDocRef);
  let members = [];
  if (chatDoc.exists()) {
    members = chatDoc.data().members || [];
  } else if (currentContact && !currentContact.isGroup) {
    members = [currentUser.uid, currentContact.userId];
    await setDoc(chatDocRef, { members, isGroup: false });
  }

  await sendMessageToChat(currentChatId, currentUser.uid, currentContact?.userId || '', messageData);

  const recipients = members.filter(id => id !== currentUser.uid);
  if (recipients.length > 0) {
    const batch = writeBatch(db);
    for (const userId of recipients) {
      if (isSystemBotUser(userId)) continue;
      const recipientRef = doc(db, 'users', userId);
      const recipientSnap = await getDoc(recipientRef);
      if (recipientSnap.exists()) {
        batch.update(recipientRef, { unreadChats: arrayUnion(currentChatId) });
      }
    }
    await batch.commit();
  }
}

async function decryptMessageForDisplay(chatId, data) {
  if (!data.encryptedPayload) {
    return data;
  }

  const decrypted = await decryptChatPayload(chatId, data.encryptedPayload);
  if (!decrypted) {
    return { ...data, text: data.type === 'image' ? data.imageUrl : '' };
  }

  return { ...data, ...decrypted };
}

async function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (text) {
    input.value = '';
    await sendMessage(text, 'text');
  }
}

function openContactActionsModal(contact) {
  const content = `
    <div class="flex flex-col space-y-2">
      <button id="edit-contact-action" class="text-left w-full p-2 rounded-md hover:bg-gray-100">Edit Contact</button>
      <button id="delete-contact-action" class="text-left w-full p-2 rounded-md hover:bg-gray-100 text-red-600">Delete (Block) Contact</button>
    </div>
  `;
  showModal(`Actions for ${contact.name}`, content, () => true, 'Close', 'Close');
  document.getElementById('edit-contact-action').addEventListener('click', () => {
    document.querySelector('.fixed.inset-0')?.remove();
    openEditContactModal(contact);
  });
  document.getElementById('delete-contact-action').addEventListener('click', () => {
    document.querySelector('.fixed.inset-0')?.remove();
    openDeleteContactModal(contact);
  });
}

function openDeleteContactModal(contact) {
  showModal(
    `Delete ${contact.name}?`,
    `<p class="text-sm text-gray-500">This will remove the contact for both of you and cannot be undone.</p>`,
    async () => {
      try {
        const contactUserRef = doc(db, 'users', contact.userId);
        const currentUserRef = doc(db, 'users', currentUser.uid);
        const contactToRemoveFromCurrentUser = currentUserData.contacts.find(c => c.userId === contact.userId);
        const contactUserDoc = await getDoc(contactUserRef);
        const contactUserData = contactUserDoc.data();
        const currentUserToRemoveFromContact = contactUserData.contacts.find(c => c.userId === currentUser.uid);
        const batch = writeBatch(db);
        batch.update(currentUserRef, { contacts: arrayRemove(contactToRemoveFromCurrentUser) });
        if (currentUserToRemoveFromContact) {
          batch.update(contactUserRef, { contacts: arrayRemove(currentUserToRemoveFromContact) });
        }
        await batch.commit();
        return true;
      } catch (error) {
        console.error('Error deleting contact:', error);
        return false;
      }
    },
    'Delete',
    'Cancel'
  );
}

function openAddContactModal() {
  const content = `
    <p class="text-sm text-gray-500 mb-4">Enter the 5-digit UID and a name for your new contact.</p>
    <input id="contact-uid-input" type="text" placeholder="Contact's UID" class="mb-2 w-full px-3 py-2 border rounded-md">
    <input id="contact-name-input" type="text" placeholder="Contact's Name" class="w-full px-3 py-2 border rounded-md">
    <p id="add-contact-error" class="text-red-500 text-sm mt-2"></p>
  `;
  showModal('Add New Contact', content, async () => {
    const uid = document.getElementById('contact-uid-input').value;
    const name = document.getElementById('contact-name-input').value;
    const errorP = document.getElementById('add-contact-error');
    errorP.textContent = '';

    if (!uid || !name) {
      errorP.textContent = 'Both UID and Name are required.';
      return false;
    }
    if (uid === currentUserData.uid) {
      errorP.textContent = "You can't add yourself as a contact.";
      return false;
    }

    try {
      const q = query(collection(db, 'users'), where('uid', '==', uid));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        errorP.textContent = 'User with this UID not found.';
        return false;
      }

      const contactUserDoc = querySnapshot.docs[0];
      const contactUserData = contactUserDoc.data();
      if (currentUserData.contacts.some(c => c.userId === contactUserDoc.id)) {
        errorP.textContent = 'This user is already in your contacts.';
        return false;
      }

      const newContactForCurrentUser = { userId: contactUserDoc.id, name, profilePictureUrl: contactUserData.profilePictureUrl || '' };
      const currentUserForNewContact = { userId: currentUser.uid, name: currentUserData.username, profilePictureUrl: currentUserData.profilePictureUrl || '' };
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', currentUser.uid), { contacts: arrayUnion(newContactForCurrentUser) });
      batch.update(doc(db, 'users', contactUserDoc.id), { contacts: arrayUnion(currentUserForNewContact) });
      await batch.commit();
      return true;
    } catch (error) {
      errorP.textContent = 'Error adding contact. Please try again.';
      console.error('Add contact error:', error);
      return false;
    }
  }, 'Add Contact');
}

function openEditContactModal(contact) {
  const content = `
    <p class="text-sm text-gray-500 mb-4">Edit the name for this contact.</p>
    <input id="edit-contact-name-input" type="text" value="${escapeAttr(contact.name)}" class="w-full px-3 py-2 border rounded-md">
    <p id="edit-contact-error" class="text-red-500 text-sm mt-2"></p>
  `;
  showModal('Edit Contact Name', content, async () => {
    const newName = document.getElementById('edit-contact-name-input').value;
    if (!newName) {
      document.getElementById('edit-contact-error').textContent = 'Name cannot be empty.';
      return false;
    }

    const updatedContacts = currentUserData.contacts.map(c => c.userId === contact.userId ? { ...c, name: newName } : c);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { contacts: updatedContacts });
      return true;
    } catch {
      document.getElementById('edit-contact-error').textContent = 'Failed to update name.';
      return false;
    }
  }, 'Save Changes');
}

function openCreateGroupModal() {
  const individualContacts = (currentUserData.contacts || []).filter(c => !c.isGroup && c.userId !== 'connectsphere_bot');
  if (individualContacts.length === 0) {
    showModal('No Contacts', '<p class="text-sm text-gray-500">You need to add contacts before you can create a group.</p>', () => true, 'OK');
    return;
  }

  const contactsHTML = individualContacts.map(contact => `
    <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100">
      <input type="checkbox" data-id="${contact.userId}" class="form-checkbox h-5 w-5 text-indigo-600 rounded">
      <img src="${contact.profilePictureUrl || `https://placehold.co/40x40/A5B4FC/312E81?text=${contact.name.charAt(0).toUpperCase()}`}" class="w-8 h-8 rounded-full object-cover">
      <span class="text-gray-700">${contact.name}</span>
    </label>
  `).join('');

  const content = `
    <div class="space-y-4 text-left">
      <input id="group-name-input" type="text" placeholder="Group Name" class="w-full px-3 py-2 border rounded-md">
      <p class="font-medium text-gray-700">Select Members:</p>
      <div class="max-h-48 overflow-y-auto border rounded-md p-2">${contactsHTML}</div>
      <p id="create-group-error" class="text-red-500 text-sm"></p>
    </div>
  `;

  showModal('Create New Group', content, async () => {
    const groupName = document.getElementById('group-name-input').value.trim();
    const errorP = document.getElementById('create-group-error');
    if (!groupName) {
      errorP.textContent = 'Group name is required.';
      return false;
    }

    const selectedMembers = Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.dataset.id);
    if (selectedMembers.length < 1) {
      errorP.textContent = 'You must select at least one member.';
      return false;
    }

    const allMemberIds = [...new Set([currentUser.uid, ...selectedMembers])];
    try {
      const groupDocRef = await addDoc(collection(db, 'chats'), {
        groupName,
        members: allMemberIds,
        admins: [currentUser.uid],
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        isGroup: true,
        profilePictureUrl: ''
      });

      const newGroupContact = { isGroup: true, groupId: groupDocRef.id, groupName, profilePictureUrl: '' };
      const batch = writeBatch(db);
      allMemberIds.forEach(userId => batch.update(doc(db, 'users', userId), { contacts: arrayUnion(newGroupContact) }));
      await batch.commit();
      return true;
    } catch (error) {
      console.error('Group creation failed:', error);
      errorP.textContent = 'Failed to create group.';
      return false;
    }
  }, 'Create Group');
}

async function openManageGroupModal(groupData) {
  const memberDocs = await Promise.all(groupData.members.map(id => getDoc(doc(db, 'users', id))));
  const memberData = memberDocs.map(d => ({ id: d.id, ...d.data() }));
  const membersHTML = memberData.map(member => {
    const isAdmin = groupData.admins.includes(member.id);
    const isCurrentUser = member.id === currentUser.uid;
    let actionButtons = '';
    if (!isCurrentUser) {
      actionButtons += isAdmin ? `<button class="demote-btn text-xs bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600" data-member-id="${member.id}">Demote</button>` : `<button class="promote-btn text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600" data-member-id="${member.id}">Promote</button>`;
      actionButtons += `<button class="remove-btn text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 ml-2" data-member-id="${member.id}">Remove</button>`;
    }
    return `<div class="flex items-center justify-between p-2 border-b"><div><p class="font-semibold">${sanitizeHTML(member.username)}</p><p class="text-xs text-gray-500">${isAdmin ? 'Admin' : 'Member'}</p></div><div class="flex gap-2">${actionButtons}</div></div>`;
  }).join('');

  const content = `
    <div class="space-y-4 text-left">
      <div class="max-h-64 overflow-y-auto">${membersHTML}</div>
      <hr>
      <button id="add-member-btn" class="w-full text-center px-3 py-2 rounded-md text-indigo-600 bg-indigo-50 hover:bg-indigo-100 font-semibold">Add Member</button>
      <button id="delete-group-btn" class="w-full text-center px-3 py-2 rounded-md text-red-600 bg-red-50 hover:bg-red-100 font-semibold mt-2">Delete Group</button>
      <p id="manage-group-error" class="text-red-500 text-sm"></p>
    </div>
  `;

  showModal(`Manage "${groupData.groupName}"`, content, () => true, 'Done', 'Done');
  document.querySelectorAll('.promote-btn').forEach(btn => btn.addEventListener('click', e => handleAdminAction('promote', e.target.dataset.memberId, groupData.groupId)));
  document.querySelectorAll('.demote-btn').forEach(btn => btn.addEventListener('click', e => handleAdminAction('demote', e.target.dataset.memberId, groupData.groupId)));
  document.querySelectorAll('.remove-btn').forEach(btn => btn.addEventListener('click', e => handleAdminAction('remove', e.target.dataset.memberId, groupData.groupId)));
  document.getElementById('add-member-btn').addEventListener('click', () => openAddMemberToGroupModal(groupData));
  document.getElementById('delete-group-btn').addEventListener('click', () => handleDeleteGroup(groupData));
}

async function handleAdminAction(action, memberId, groupId) {
  const groupRef = doc(db, 'chats', groupId);
  const errorP = document.getElementById('manage-group-error');
  if (errorP) errorP.textContent = '';

  try {
    await runTransaction(db, async transaction => {
      const groupDoc = await transaction.get(groupRef);
      if (!groupDoc.exists()) throw new Error('Group not found.');
      const group = groupDoc.data();
      if ((action === 'demote' || action === 'remove') && group.admins.includes(memberId) && group.admins.length <= 1) {
        throw new Error('Cannot remove or demote the last admin.');
      }

      if (action === 'promote') {
        transaction.update(groupRef, { admins: arrayUnion(memberId) });
      } else if (action === 'demote') {
        transaction.update(groupRef, { admins: arrayRemove(memberId) });
      } else if (action === 'remove') {
        transaction.update(groupRef, { members: arrayRemove(memberId), admins: arrayRemove(memberId) });
        const userRef = doc(db, 'users', memberId);
        const userDoc = await transaction.get(userRef);
        if (userDoc.exists()) {
          const updatedContacts = (userDoc.data().contacts || []).filter(c => c.groupId !== groupId);
          transaction.update(userRef, { contacts: updatedContacts });
        }
      }
    });

    const updatedGroupDoc = await getDoc(groupRef);
    if (updatedGroupDoc.exists()) {
      const fullGroupData = { groupId: updatedGroupDoc.id, ...updatedGroupDoc.data() };
      openManageGroupModal(fullGroupData);
      const oldModal = document.querySelector('.fixed.inset-0');
      if (oldModal && oldModal.previousElementSibling?.classList.contains('fixed')) {
        oldModal.previousElementSibling.remove();
      }
    }
  } catch (error) {
    console.error('Admin action error:', error);
    if (errorP) errorP.textContent = error.message;
  }
}

function handleDeleteGroup(groupData) {
  showModal(
    `Delete "${groupData.groupName}"?`,
    '<p class="text-sm text-gray-500">This action is permanent and will remove the group for all members.</p>',
    async () => {
      try {
        const batch = writeBatch(db);
        for (const memberId of groupData.members) {
          const userRef = doc(db, 'users', memberId);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            const updatedContacts = (userDoc.data().contacts || []).filter(c => c.groupId !== groupData.groupId);
            batch.update(userRef, { contacts: updatedContacts });
          }
        }
        batch.delete(doc(db, 'chats', groupData.groupId));
        await batch.commit();
        document.querySelectorAll('.fixed.inset-0').forEach(el => el.remove());
        closeChatOnMobile();
        return true;
      } catch (error) {
        console.error('Error deleting group:', error);
        return false;
      }
    },
    'Delete Group',
    'Cancel'
  );
}

function openAddMemberToGroupModal(groupData) {
  const potentialMembers = (currentUserData.contacts || []).filter(contact => !contact.isGroup && contact.userId !== 'connectsphere_bot' && !groupData.members.includes(contact.userId));
  if (potentialMembers.length === 0) {
    showModal('No Contacts to Add', '<p class="text-sm text-gray-500">All of your contacts are already in this group.</p>', () => true, 'OK');
    return;
  }

  const contactsHTML = potentialMembers.map(contact => `
    <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100">
      <input type="checkbox" data-id="${contact.userId}" class="form-checkbox h-5 w-5 text-indigo-600 rounded">
      <img src="${contact.profilePictureUrl || `https://placehold.co/40x40/A5B4FC/312E81?text=${contact.name.charAt(0).toUpperCase()}`}" class="w-8 h-8 rounded-full object-cover">
      <span class="text-gray-700">${contact.name}</span>
    </label>
  `).join('');

  const content = `
    <div class="space-y-4 text-left">
      <p class="font-medium text-gray-700">Select contacts to add:</p>
      <div class="max-h-48 overflow-y-auto border rounded-md p-2">${contactsHTML}</div>
      <p id="add-member-error" class="text-red-500 text-sm"></p>
    </div>
  `;

  showModal('Add Members', content, async () => {
    const errorP = document.getElementById('add-member-error');
    const selectedMemberIds = Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.dataset.id);
    if (selectedMemberIds.length === 0) {
      errorP.textContent = 'Please select at least one contact to add.';
      return false;
    }

    try {
      const groupRef = doc(db, 'chats', groupData.groupId);
      const groupContactInfo = currentUserData.contacts.find(c => c.groupId === groupData.groupId);
      const batch = writeBatch(db);
      batch.update(groupRef, { members: arrayUnion(...selectedMemberIds) });
      selectedMemberIds.forEach(userId => {
        batch.update(doc(db, 'users', userId), { contacts: arrayUnion(groupContactInfo) });
      });
      await batch.commit();
      document.querySelector('.fixed.inset-0')?.remove();
      const updatedGroupDoc = await getDoc(groupRef);
      if (updatedGroupDoc.exists()) {
        const fullGroupData = { groupId: updatedGroupDoc.id, ...updatedGroupDoc.data() };
        openManageGroupModal(fullGroupData);
      }
      return true;
    } catch (error) {
      console.error('Error adding members:', error);
      errorP.textContent = 'Failed to add members.';
      return false;
    }
  }, 'Add Selected');
}

function openSettingsModal() {
  const safeCurrentUserData = currentUserData || {
    username: getFallbackUsername(currentUser),
    profilePictureUrl: '',
    uid: '...'
  };
  const content = `
    <div class="space-y-4 text-left">
      <div>
        <label class="block text-sm font-medium text-gray-700">Profile Picture</label>
        <div class="mt-1 flex items-center space-x-4">
          <img id="settings-profile-pic-preview" src="${safeCurrentUserData.profilePictureUrl || `https://placehold.co/64x64/E2E8F0/4A5568?text=${sanitizeHTML(safeCurrentUserData.username.charAt(0).toUpperCase())}`}" class="w-16 h-16 rounded-full object-cover">
          <input type="file" id="profile-pic-upload" accept="image/*" class="hidden">
          <button id="change-pic-btn" class="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50">Change</button>
        </div>
      </div>
      <div class="relative">
        <label for="settings-username" class="block text-sm font-medium text-gray-700">Username</label>
        <span class="absolute top-8 left-0 flex items-center pl-3"><svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" /></svg></span>
        <input type="text" id="settings-username" value="${escapeAttr(safeCurrentUserData.username)}" class="mt-1 block w-full px-3 py-2 pl-10 border rounded-md">
      </div>
      <div class="relative">
        <label for="settings-password" class="block text-sm font-medium text-gray-700">New Password</label>
        <span class="absolute top-8 left-0 flex items-center pl-3"><svg class="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" /></svg></span>
        <input type="password" id="settings-password" placeholder="Leave blank to keep current" class="mt-1 block w-full px-3 py-2 pl-10 border rounded-md">
      </div>
      <p id="settings-error" class="text-red-500 text-sm"></p>
      <hr>
      <button id="logout-btn" class="w-full text-left px-3 py-2 rounded-md text-red-600 hover:bg-red-50">Log Out</button>
    </div>
  `;

  showModal('Settings', content, async () => {
    const errorP = document.getElementById('settings-error');
    errorP.textContent = '';
    try {
      const userDocRef = doc(db, 'users', currentUser.uid);
      const newUsername = document.getElementById('settings-username').value;
      const newPassword = document.getElementById('settings-password').value;
      const fileInput = document.getElementById('profile-pic-upload');
      const file = fileInput.files[0];
      let passwordTried = false;

      if (newUsername !== safeCurrentUserData.username) {
        await updateDoc(userDocRef, { username: newUsername });
      }
      if (newPassword) {
        passwordTried = true;
        try {
          await updatePassword(currentUser, newPassword);
        } catch (error) {
          if (error.code === 'auth/requires-recent-login') {
            errorP.textContent = 'Please log in again to update your password.';
            return false;
          }
          errorP.textContent = error.message;
          return false;
        }
      }
      if (file) {
        if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
          errorP.textContent = 'Only images under 2MB are allowed.';
          return false;
        }
        errorP.textContent = 'Uploading image...';
        const imageUrl = await uploadImageToImgbb(file);
        await updateDoc(userDocRef, { profilePictureUrl: imageUrl });
        try {
          const allUsersSnap = await getDocs(collection(db, 'users'));
          for (const docSnap of allUsersSnap.docs) {
            const userContacts = docSnap.data().contacts || [];
            let updated = false;
            const newContacts = userContacts.map(contact => {
              if (contact.userId === currentUser.uid) {
                updated = true;
                return { ...contact, profilePictureUrl: imageUrl };
              }
              return contact;
            });
            if (updated) {
              await updateDoc(doc(db, 'users', docSnap.id), { contacts: newContacts });
            }
          }
        } catch (err) {
          console.error('Error propagating profilePictureUrl:', err);
        }
        const cacheBustedUrl = `${imageUrl}?t=${Date.now()}`;
        document.querySelectorAll('#user-profile-pic, #settings-profile-pic-preview, #chat-contact-pic').forEach(el => { el.src = cacheBustedUrl; });
        currentUserData.profilePictureUrl = imageUrl;
      }
      return true;
    } catch (error) {
      if (error.code === 'auth/requires-recent-login' && !passwordTried) return false;
      errorP.textContent = error.message || 'Update failed. This could be a network issue. Please try again.';
      console.error('Settings update error:', error);
      return false;
    }
  }, 'Save Changes');

  const fileInput = document.getElementById('profile-pic-upload');
  const previewImg = document.getElementById('settings-profile-pic-preview');
  const changeBtn = document.getElementById('change-pic-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (changeBtn && fileInput) changeBtn.onclick = () => fileInput.click();
  if (fileInput && previewImg) {
    fileInput.onchange = e => {
      const file = e.target.files[0];
      if (file) {
        if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
          document.getElementById('settings-error').textContent = 'Only images under 2MB are allowed.';
          return;
        }
        const reader = new FileReader();
        reader.onload = event => { previewImg.src = event.target.result; };
        reader.readAsDataURL(file);
      }
    };
  }
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await signOut(auth);
      document.querySelector('.fixed.inset-0')?.remove();
    };
  }
}

function renderChatMessagesDecrypted(chatId, snapshot) {
  return Promise.all(snapshot.docs.map(async messageDoc => {

    const raw = messageDoc.data();

    console.log("RAW MESSAGE:", raw);
    console.log("TIMESTAMP:", raw.timestamp);
    console.log("TIMESTAMP TYPE:", raw.timestamp?.constructor?.name);

    return decryptMessageForDisplay(chatId, {
      id: messageDoc.id,
      ...raw
    });
  }));
}

async function bootstrapChatMessageListener(chatId, messagesContainer, isGroup) {
  const messagesQuery = query(collection(db, 'chats', chatId, 'messages'), orderBy('timestamp'));
  unsubscribeMessages = onSnapshot(messagesQuery, async snapshot => {
    const decryptedMessages = await renderChatMessagesDecrypted(chatId, snapshot);
    messagesContainer.innerHTML = '';
    lastMessageDate = null;
    let unreadDividerPlaced = false;

    decryptedMessages.forEach(data => {
      if (data.deletedFor && data.deletedFor.includes(currentUser.uid)) return;
      if (!data.isRead && data.senderId !== currentUser.uid && !unreadDividerPlaced) {
        const divider = document.createElement('div');
        divider.className = 'text-center my-2';
        divider.innerHTML = `<span class="bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full">Unread Messages</span>`;
        messagesContainer.appendChild(divider);
        unreadDividerPlaced = true;
      }
      renderMessage(data);
    });

    if (!isGroup) markMessagesAsRead();
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

function initializeAppShell() {
  if (page === 'landing') {
    navigate('landing');
  } else if (page === 'auth') {
    navigate('auth');
  } else if (page === 'chat') {
    renderLoadingPage();
    onAuthStateChanged(auth, async user => {
      if (user) {
        currentUser = user;
        navigate('chat');
        await setupFirebaseMessaging();
      } else {
        currentUser = null;
        currentUserData = null;
        window.location.href = 'auth.html';
      }
    });
  } else {
    navigate('landing');
  }
}

onAuthStateChanged(auth, user => {
  if (page !== 'chat') {
    if (user && page === 'auth') {
      window.location.href = 'Chat.html';
      return;
    }
    if (!user && page === 'chat') {
      window.location.href = 'auth.html';
      return;
    }
  }
});

initializeAppShell();
