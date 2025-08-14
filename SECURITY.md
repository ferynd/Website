# Security & Privacy

This site is a **client-first** Next.js app with static sub-sites. There is **no server-side secret logic** in this repo. 
Persistence is provided via **Firebase (Auth + Firestore)** for selected tools.

## Secrets & Keys
- **Firebase web config** (`app/tools/trip-cost/firebaseConfig.ts` and `/public/tools/CalorieTracker/firebaseConfig.js`) contains **public identifiers**. 
  - These MUST NOT be treated as secrets; access is controlled by **Firestore Security Rules**.
  - Do **not** commit any private server keys, service account JSON, or API tokens.
- Never log PII, tokens, or auth data to the console. Avoid printing document contents that could include personal information.

## Authentication
- Email/password via Firebase Auth on Trip Cost (and optionally in Calorie Tracker).
- The admin user is `arkkahdarkkahd@gmail.com` (see `ADMIN_EMAIL` in the Trip Cost config). Use this only for approvals and privileged actions.

## Firestore Structure
Trip Cost data lives under `artifacts/trip-cost/**` (see **ARCHITECTURE.md**). Calorie Tracker uses `artifacts/<appId>/users/{uid}/**` scoped to a user.

## Firestore Security Rules (authoritative)
The following ruleset (provided by the repo owner) governs what clients can read/write. Keep this in sync with any data model changes.

```firebase
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }
    function isAdmin() {
      return isSignedIn() && request.auth.token.email == 'arkkahdarkkahd@gmail.com';
    }
    // Is the caller a participant on this trip?
    function isTripParticipant(tripId) {
      return isSignedIn() &&
        request.auth.uid in
        get(/databases/$(database)/documents/artifacts/trip-cost/trips/$(tripId)).data.participantIds;
    }
    
    // Helper function to check if update is only adding participants/expenses/payments
    function isAllowedTripUpdate() {
      let allowedFields = ['participants', 'participantIds', 'expenses', 'payments', 'updatedAt'];
      return request.resource.data.diff(resource.data).affectedKeys().hasOnly(allowedFields);
    }
    
    // --- KEEP: Calorie Tracker (any appId) ---
    // Allows users to read/write anything under their own user folder
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if isSignedIn() && request.auth.uid == userId;
    }
    
    // --- Trip Cost app ---
    // Trip Cost user profile document (document at /users/{uid})
    match /artifacts/trip-cost/users/{uid} {
      allow read: if isAdmin() || (isSignedIn() && request.auth.uid == uid);
      allow create: if isSignedIn() && request.auth.uid == uid;
      allow update, delete: if isAdmin() || (isSignedIn() && request.auth.uid == uid);
    }
    
    // Trip documents
    match /artifacts/trip-cost/trips/{tripId} {
      // Admin sees all; participants can read their trips
      allow read: if isAdmin() || isTripParticipant(tripId);
      
      // Admin can do anything
      allow create, delete: if isAdmin();
      
      // UPDATED: Allow participants to update trips for adding participants, expenses, and payments
      allow update: if isAdmin() || 
                      (isTripParticipant(tripId) && isAllowedTripUpdate());
    }
    
    // Admin-only audit log for each trip
    match /artifacts/trip-cost/trips/{tripId}/audit/{logId} {
      allow read: if isAdmin();
      // Allow users to append their own audit entries. For stronger integrity, move to Cloud Functions.
      allow create: if isSignedIn() && request.resource.data.actorUid == request.auth.uid;
      allow update, delete: if false;
    }
    
    // (Optional, future) Participant-scoped edits in subcollections:
    match /artifacts/trip-cost/trips/{tripId}/expenses/{expenseId} {
      allow read: if isAdmin() || isTripParticipant(tripId);
      allow create: if isTripParticipant(tripId) &&
                    request.resource.data.createdBy == request.auth.uid;
      allow update, delete: if isAdmin() ||
                            (isTripParticipant(tripId) && resource.data.createdBy == request.auth.uid);
    }
    
    match /artifacts/trip-cost/trips/{tripId}/payments/{paymentId} {
      allow read: if isAdmin() || isTripParticipant(tripId);
      allow create: if isTripParticipant(tripId) &&
                    request.resource.data.payerId == request.auth.uid;
      allow update, delete: if isAdmin() ||
                            (isTripParticipant(tripId) && resource.data.payerId == request.auth.uid);
    }
  }
}
```

**Rule highlights:**
- **Signed-in users only** may access their own Calorie Tracker subtree.
- Trip Cost:
  - **Admin** can create/delete trips and read all; **participants** can read their trips.
  - **Participants** may update a trip **only** to add participants/expenses/payments (`isAllowedTripUpdate`).
  - Subcollections (`expenses`, `payments`) enforce **creator-owned edits** where applicable.
  - **Audit** subcollection is read-only to admin; any user can append entries with their own `actorUid` (consider moving to a Cloud Function for tamper resistance).

## Supply-chain & XSS Considerations
- Static sub-sites under `/public` may include third-party scripts (Firebase, Chart.js). Prefer **pinned versions** and integrity attributes where feasible.
- Avoid `innerHTML` with untrusted data in static apps. Use DOM APIs and escape user input before rendering.
- Do not include untrusted external scripts/styles in production without review.

## Data Minimization & Retention
- Store only what is necessary for features (e.g., trip participants/emails, expenses, payments). 
- If you add analytics or additional PII, document the fields and update this SECURITY.md.

## When to Update this Document
- Any change to auth flows, Firestore structure, **rules**, data retention, or external scripts.
- Any new tool that persists user data or reads sensitive data.

