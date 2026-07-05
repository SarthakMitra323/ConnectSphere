importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyD8Il1stHhvl_PgqwoN2-rKZQXut3B-qAY',
  authDomain: 'connectsphere-web.firebaseapp.com',
  projectId: 'connectsphere-web',
  messagingSenderId: '477654366755',
  appId: '1:477654366755:web:1577289f86ea71c3734f96',
  measurementId: 'G-4YPV9Y5ZJQ'
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