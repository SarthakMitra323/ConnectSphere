# ConnectSphere

ConnectSphere is a privacy-first messaging app with separate landing, auth, and chat pages. It uses Firebase Authentication, Cloud Firestore, and encrypted message payloads for chat content. Profile pictures and uploaded chat images do not use Firebase Storage in this build.

## Features

- Email and password authentication
- One-to-one chats and group chats
- Encrypted message payloads before Firestore write
- Read receipts and typing indicators
- Profile picture updates
- Image sharing through the current external image host flow
- Responsive landing page and polished UI

## Tech Stack

- HTML, CSS, and vanilla JavaScript
- Firebase Authentication
- Cloud Firestore
- Firebase Cloud Messaging
- Client-side AES-GCM message encryption
- External image upload provider for profile pictures and chat images

## Project Files

- [index.html](index.html) - landing page
- [auth.html](auth.html) - sign up and sign in page
- [Chat.html](Chat.html) - chat page shell
- [script.js](script.js) - app logic and UI rendering
- [firebase.js](firebase.js) - Firebase bootstrap and encryption helpers
- [style.css](style.css) - shared styling
- [firestore.rules](firestore.rules) - Firestore security rules

## Setup

1. Open the project in a browser or serve it through a local web server.
2. Configure the Firebase project in [firebase.js](firebase.js).
3. Enable Authentication and Cloud Firestore in the Firebase console.
4. Deploy the Firestore rules from [firestore.rules](firestore.rules).
5. Make sure the external image upload provider used by the app is available, since this build does not depend on Firebase Storage.

## Security Model

- Chat messages are encrypted on the client before they are stored.
- Firestore rules restrict reads and writes to authenticated users and chat members.
- Profile data stored in Firestore is intentionally minimal.
- The app does not rely on Firebase Storage in the current setup.

## Firestore Rules Summary

- Users can read authenticated app data and update only their own profile document.
- Message documents are readable only inside chats that include the current user.
- Message creation is limited to the authenticated sender.
- Group membership changes are restricted to chat admins.

## Testing Notes

- Syntax checks were run on the edited JavaScript files.
- The auth page was opened in the browser to verify the page still renders.
- The current repository does not include automated tests.

## Notes

- If you want to swap the image host later, update the upload helper in [script.js](script.js).
- The app is designed to stay usable without Firebase Storage.