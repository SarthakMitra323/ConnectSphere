importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDjoAFCAxRv0JZXFzogDKac4EFv4EWh86E",
  authDomain: "connectsphere-db.firebaseapp.com",
  projectId: "connectsphere-db",
  storageBucket: "connectsphere-db.firebasestorage.app",
  messagingSenderId: "172415675184",
  appId: "1:172415675184:web:628d46549d7fa7ef3cf6f5",
  measurementId: "G-49SLSX3ZL8"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload?.notification?.title || 'ConnectSphere';
  const options = {
    body: payload?.notification?.body || '',
    data: payload?.data || {}
  };

  self.registration.showNotification(title, options);
});