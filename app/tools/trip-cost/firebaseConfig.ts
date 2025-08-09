// Firebase configuration and admin constants for the Trip Cost tool.
//
// These keys point to the same Firebase project used by the Calorie Tracker.
// They are publicly accessible identifiers and are safe to commit.

export const firebaseConfig = {
  apiKey: "AIzaSyBH...ZDss",
  authDomain: "jlb-calorietracker.firebaseapp.com",
  projectId: "jlb-calorietracker",
  storageBucket: "jlb-calorietracker.firebasestorage.app",
  messagingSenderId: "994744135946",
  appId: "1:994744135946:web:ccf2aa11ce73c2c77c4af3",
  measurementId: "G-3SWQ8KQ2EQ",
} as const;

// The email address of the site owner.  Users with this email are treated as
// administrators within the Trip Cost app.  Never store passwords in code.
export const ADMIN_EMAIL = 'arkkahdarkkahd@gmail.com';
