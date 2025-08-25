# My Website & Digital Garden

Welcome to my personal website project! This repository is a monorepo containing all of my creative and technical projects – including interactive games, handy tools, and travel trip logs. The site is built with Next.js (App Router) and Tailwind CSS for a modern, fast, and scalable user experience. It serves as a hub (a "digital garden") where I curate projects, ideas, and adventures in one place.

## Tech Stack

- **Framework:** Next.js (using the App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS (with official plugins for forms & typography)
- **Deployment:** Cloudflare Pages
- **Backend Services:** Firebase (Authentication & Firestore, used in certain tools)

This stack means the site is primarily a static front-end (deployed on Cloudflare Pages) with some dynamic client-side features. Firebase is used as a backend for data-heavy features (e.g. saving user data for certain tools like the Trip Cost calculator or Calorie Tracker).

### Shared UI tokens

Static tools under `/public` share utility classes and color tokens defined in `public/shared-styles.css`:

- `.hbar` with `.hbar-fill` and `.hbar-marker` draws horizontal KPI bars on a 0–150% scale with a 100% marker.
- `.kpi-row` standardizes KPI label/value layouts.
- `--chart-1-hex` … `--chart-8-hex` variables supply chart colors consumed via `CONFIG.CHART_COLORS`.

## Project Structure

The project uses a flat, intuitive structure to organize content. The main directories are:

### /app – Next.js application pages and routes

Each folder under /app represents a URL path segment. Key pages include:

- **app/page.tsx** – The home page (landing hub)
- **app/games/page.tsx** – The Games listing page (shows all games)
- **app/tools/page.tsx** – The Tools listing page (shows all tools)
- **app/trips/page.tsx** – The Trips listing page (shows all travel logs/itineraries)
- **app/style-guide/page.tsx** – A Style Guide page (for UI components and theming)
- **app/\[section\]/...** – Other sections can be added similarly (each with their own subfolder and page.tsx)

Under each section, the Next.js App Router allows further nesting. For example, the Trip Cost tool has its own subdirectory under app/tools/trip-cost/ with multiple components and utilities inside.

The app/layout.tsx file defines the layout applied to all pages (e.g. it includes the site &lt;Nav&gt; and global styles). The app/globals.css file contains global Tailwind CSS styles (included in every page).

### /components – Reusable React components

Common UI elements (buttons, inputs, navigation bar, cards, etc.) reside here, especially if used in multiple pages. Currently, some shared components include:

- components/Nav.tsx – The navigation bar (site header with links)
- components/Button.tsx – A custom button component (with variants/styles)
- components/Input.tsx – A custom text input field
- components/Select.tsx – A custom select dropdown
- components/ProjectCard.tsx – A card layout for displaying project info

These components are imported into pages as needed. For example, the navigation bar &lt;Nav /&gt; is used on several pages, and the Style Guide page renders the Button, Input, Select, etc., to demonstrate the styling.

### /content – Markdown content (planned)

This is intended for any long-form content such as blog posts, articles, or trip write-ups in Markdown/MDX format. For example, travel journals or blog entries can be written as .md files here. The site can be configured to read these files and generate pages from them (using an MDX library), making it easy to add written content without building a new page by hand. _Currently, this folder is a placeholder (no significant content yet), but it’s set aside for future expansion._

### /lib – Libraries and utilities

Helper functions, configuration files, and utilities live here. (For instance, if we externalized complex logic or needed shared utility modules, they would go in /lib.) At the moment, this folder is minimal, since most logic is either in components or specific to a tool, but it exists to hold things like API clients, configuration, or context providers that are not React components.

### /public – Static assets and standalone content

This houses all static files that are served as-is. It's the home for self-contained HTML/JS games and tools, as well as images, icons, and other static files. Any folder you put here is accessible directly via URL. For example, a game placed in public/games/MyGame/ would be accessible at your-domain.com/games/MyGame/index.html.

Inside /public, content is organized into subfolders:

- **public/games/** – Contains standalone game projects (each in its own subfolder with an index.html entry point and supporting assets).
- **public/tools/** – Contains standalone tools or apps (each in its own subfolder, e.g. a tool with its own index.html and resources).
- **public/trips/** – Contains static trip itineraries or travel pages (each as a subfolder with an index.html).

**Note:** Because the site uses Next.js App Router, any route that doesn't have a specific Next.js page falls back to static assets if available. The Next.js pages (in /app) handle the main sections and their listings, while the actual game/tool content might be pure static files in /public (especially for projects that don't need React or dynamic rendering).

## Home Page (Hub)

The home page (/app/page.tsx) is the central hub of the site. It introduces the website as a "Digital Garden" and provides an overview of what you can find here. The home page displays three main categories – **Games**, **Tools**, and **Trips** – each with a brief description and an icon. For example, on the homepage you will see cards for:

- **Games** – _"Interactive projects and games built with code."_ Clicking this takes you to the Games section.
- **Tools** – _"Useful utilities and apps to solve problems."_ Links to the Tools section.
- **Trips** – _"A collection of travel logs, photos, and stories."_ Links to the Trips section.

Each category card on the home page has a distinctive icon (e.g., a game controller for Games, a wrench or calculator for Tools, an airplane for Trips) and a colored gradient border on hover. The cards are implemented in a responsive grid, so they look good on both mobile and desktop. The home page’s purpose is to help visitors navigate into the specific area they're interested in.

Additionally, the home page includes the site navigation bar (&lt;Nav&gt; component) at the top, which provides links to each section as well.

## Games Section

The **Games** section is for interactive projects, prototypes, or storytelling games. The main Games page (/games, generated by app/games/page.tsx) lists all available games with a title, description, and link. Each game is displayed as a card with an icon and a short description, offering a quick insight into the project.

Currently, the games listed are:

### Noir Detective Idea

_“An interactive detective story concept (Static HTML).”_

This is a noir-themed detective story prototype. It is a static web project contained in **public/games/noir_detective_idea/**. To play or view it, the Games page links to **/games/noir_detective_idea/index.html**, which loads the game’s HTML file. This project likely presents a narrative or interactive story in a noir detective style. All of the game logic and content are in the static HTML/JS files (it does not use React). The site’s role is just to link to it and provide navigation.

### Emeril: A World Divided

_“An interactive lore page for a world of lost magic and warring factions.”_

This is an interactive world-building lore page, also served as static content. Its files reside in **public/games/Emeril_A_World_Divided/**. The Games page links to **/games/Emeril_A_World_Divided/index.html** to open it. This project is essentially a mini website that presents the backstory and details of a fictional world (“Emeril”). It has custom styling and interactive elements like expandable sections or tabs for different factions. For instance, the static project includes custom CSS for faction colors and scripts for interactive tabs and reveal animations. It’s a self-contained HTML/CSS/JS experience separate from the main Next.js app.

**Integration:** Both game projects are static HTML/JS content, so they do not require Next.js to run. Next.js simply provides the wrapper site and navigation. Each static game page includes a link back to the main site (for example, a “Back to Hub” or “Home” link), so that users can easily return to the main website after viewing or playing the game. This ensures the static projects feel integrated with the overall site.

To add a new game in the future, you would follow the same pattern: build the game as an HTML/JS project and place it under public/games/&lt;GameName&gt;/, then add an entry for it in the app/games/page.tsx list (with name, description, and the link to its index.html). The Games page will automatically list it alongside the others.

## Tools & Utilities Section

The **Tools** section contains practical apps and utilities. Its main page (/tools, generated by app/tools/page.tsx) lists all tools with a name, description, and link (similar to the Games page). The tools can be either static web apps (located in public/tools/...) or full React applications integrated into the Next.js app. Currently, the Tools section includes:

### Trip Cost Calculator

_“Split expenses and calculate balances for group trips with multi-user support.”_

This is a comprehensive web application to help groups track shared expenses on trips and calculate who owes whom. It started as a simple client-side calculator but has been upgraded into a full-stack app using Firebase for persistence.

- **Updated January 2025:** The Trip Cost Calculator was completely rebuilt with Firebase Authentication and Cloud Firestore for persistent, multi-user functionality. This means users can create an account (or log in), create trips, add expenses, and the data will be saved to the cloud in real-time.
- **Updated February 2025:** The tool was refactored into modular components and some bugs (like a state update loop) were fixed for improved stability and maintainability.

#### Features

**Core Functionality:**

- **Multi-Trip Management:** Create and manage multiple trips, each with their own participants and expenses.
- **User Authentication:** Secure email/password login with user profiles (first name + last initial). Users must log in to use the app. (Authentication is handled by Firebase Auth.)
- **Real-time Collaboration:** Multiple users can view and edit the same trip simultaneously. Changes sync in real time via Firestore.
- **Smart Expense Splitting:**
- Even split among selected participants.
- Manual split by percentage or fixed amounts.
- Support for multiple payers per expense (e.g., two people split the payment for one item).
- **Balance Calculations:** Automatic calculation of how much each person paid vs. how much they owe, and a summary of who should pay whom to settle up.
- **Settlement Suggestions:** The app suggests optimal repayments to settle all debts (minimizing the number of transactions).
- **Payment Tracking:** Users can record payments (when someone pays someone else to settle a debt). The tool keeps a full history of these payments.
- **Auto-Save:** All changes (expenses added, edits, payments) are saved automatically to the cloud as you go. There is no "save" button – the app continuously listens and updates Firestore.

**User Roles & Permissions:**

- **Admin (Site Owner):** There is a concept of an admin user (e.g., the site owner or a designated email). The admin has full control: can create or delete any trip, and manage all participants and expenses.
- **Regular Users:** A logged-in user can create trips and within those trips, they can add participants and expenses. Users can only see trips they created or trips to which they have been added as a participant.
- **Guest Participants:** The tool allows adding “participants” who are not registered users (for example, a friend who doesn’t have an account). These are added by name only and can be included in expenses, so the calculations still work for them – but they obviously cannot log in.
- **Expense Ownership:** Each expense record knows who created it. Only the creator of an expense or an admin can delete that expense. This prevents arbitrary deletion of expenses by other participants.

#### Technical Implementation

The Trip Cost Calculator is built as a Next.js React application integrated with Firebase. Key parts of the implementation:

- **File Structure:** All code for this tool lives under app/tools/trip-cost/:
- app/tools/trip-cost/page.tsx – The main component for the Trip Cost tool. This is a Next.js page (and a React component) that sets up the overall app UI and provides global state (using React context).
- app/tools/trip-cost/TripContext.tsx – A React Context provider that supplies trip data and functions (actions) to all components, so that deeply nested components can access and update global state easily.
- app/tools/trip-cost/components/AuthForm.tsx – Component for user sign-up/login form.
- app/tools/trip-cost/components/TripList.tsx – Component that shows the list of trips and allows creating a new trip.
- app/tools/trip-cost/components/TripDetail/ – A directory containing components for the detailed view of a single trip, split into sections:
  - TripDetail.tsx – Main container combining the sub-components for a trip.
  - ParticipantsSection.tsx – UI for managing participants in the trip.
  - ExpenseForm.tsx – Form to add a new expense.
  - ExpensesList.tsx – List of expenses already added.
  - BalanceSummary.tsx – Displays who owes who how much (with calculations).
  - PaymentHistory.tsx – List of payments that have been recorded.
  - ConfirmDeleteModal.tsx – A confirmation dialog for deleting a trip or an expense.
  - ... (and other related components like AuditLog.tsx, SettlementSuggestions.tsx if present).
- app/tools/trip-cost/constants.ts – Shared constants (like predefined categories or limits).
- app/tools/trip-cost/firebaseConfig.ts – Configuration for Firebase (contains Firebase project keys and an ADMIN_EMAIL constant to designate the admin user).
- app/tools/trip-cost/db.ts – Database helper functions to interact with Firestore (for example, functions to create a new trip document, update an expense, listen to changes, etc.).
- app/tools/trip-cost/utils/ – Utility modules, e.g., calc.ts for pure functions that handle calculation logic (splitting amounts, determining balances).
- app/tools/trip-cost/pageTypes.ts – TypeScript types/interfaces used by the Trip Cost app (for trips, expenses, users, etc.).
- **Data Architecture:** All persistent data is stored in **Firebase Cloud Firestore** under a specific path. The general structure is:
- artifacts/  
    trip-cost/  
    users/{userId} # User profiles with displayName, email, isAdmin flag  
    trips/{tripId} # Trip documents containing basic info (name, owner, etc.)  
    trips/{tripId}/participants/{participantId} # Participants sub-collection for each trip  
    trips/{tripId}/expenses/{expenseId} # Expenses sub-collection for each trip  
    trips/{tripId}/payments/{paymentId} # Payments sub-collection for each trip  
    trips/{tripId}/audit/{logId} # Audit log entries (admin-only, logs actions)
- Every trip has its own subcollections for participants, expenses, payments, and an audit log. This structure makes it easy to listen to changes on a trip's data.
- **Firebase Security:** Firebase Security Rules are set up to enforce permissions:
- Only authenticated users can read/write.
- Users can only access trips if they are the owner or a participant.
- Only the admin user (matching ADMIN_EMAIL in config) can create or delete trips (to prevent random users from spamming new trips globally).
- Only admins or the user who created an expense can delete that expense (similarly for payments).
- Audit logs are read-restricted to admins.
- **Real-time Sync:** The app uses Firestore’s real-time listeners (onSnapshot) to get live updates. When a user is viewing a trip, the app subscribes to changes on that trip’s subcollections (participants, expenses, payments, etc.). This way, if another user on a different device makes an update (adds an expense, for example), everyone sees the update instantly.
- **State Management:** Largely handled via React context (TripContext) and local component state for form inputs. Because Firestore provides the source of truth, the app state is basically a reflection of the Firestore data at any given time.
- **Performance:** Firestore queries are kept specific (loading only the data for the current trip in view, or a summary list of trips the user has access to). Also, writes are batched or atomic where appropriate to maintain consistency (for example, adding an expense might involve a transaction to update balances, which is handled in the backend rules or with careful client logic).
- **Audit Trail:** For administrative oversight, every significant action (creating a trip, adding an expense, recording a payment, etc.) can be logged to an audit subcollection with details on who performed it and when. There might be a UI in the Trip Detail view for admins to view the audit log.

**Configuration for Development:** A few steps are needed to run the Trip Cost tool on your own: 1. **Firebase Setup:** You should have a Firebase project. The Firebase config (API keys, project ID, etc.) should go into app/tools/trip-cost/firebaseConfig.ts. It exports an object with all the keys needed to initialize Firebase, as well as an ADMIN_EMAIL constant.

// Example snippet from firebaseConfig.ts  
export const firebaseConfig = {  
apiKey: "ABC123...",  
authDomain: "your-app.firebaseapp.com",  
projectId: "your-app",  
/\* ...other keys... \*/  
};  
export const ADMIN_EMAIL = '<your-email@example.com>';

Use your own Firebase project credentials here. The ADMIN_EMAIL should be set to the email you want to have admin privileges (often your own email).

1. **Firebase Project and Data:** The tool expects a Firestore database with the structure outlined above. Make sure to create proper security rules or use the provided ones if available. The tool code may assume certain indexes or rules; refer to the code or comments for any specifics.
2. **Environment Variables:** If you prefer not to hardcode firebase config in the repo, you can use environment variables (Next.js supports a .env.local file). However, since this project is deployed on static hosting, the Firebase config is currently included in the client bundle (which is generally fine for Firebase – the security comes from rules, not from hiding API keys).

Usage: When you navigate to /tools/trip-cost in the running app, it will prompt you to log in or sign up. Once authenticated, you can create a trip and start adding expenses.

_Note:_ This Trip Cost tool was originally a simpler project that reset on page reload. The 2025 rebuild turned it into a persistent multi-user app with authentication and real-time database. The additional complexity (user accounts, live sync) made it a great exercise in using Firebase with Next.js.

### Calorie Tracker

_“A tool to track daily calorie intake and nutrition (Static HTML).”_

This is a full-featured nutrition and calorie tracking web app, implemented as a static client-side project (not a React app). It lives in **public/tools/CalorieTracker/** and is accessed via the URL /tools/CalorieTracker/index.html. Despite being built as static files, it uses Firebase for data storage, allowing user data to persist across sessions.

**Overview:** The Calorie Tracker lets a user log what they eat each day and see nutritional information. It has the following main parts: - A **Daily Log** section where you enter foods for a selected date (with fields for calories, protein, carbs, etc.). - A **Staging Area** where you can paste in a chunk of text (for example, from another app or source) and the app will parse it into individual food entries (to speed up data entry). - A **Dashboard/Charts** section that visualizes your intake and progress (e.g., showing a chart of calories over time, and how it compares to your goals).

**Technology:** This tool is written with plain JavaScript, HTML, and uses Tailwind CSS for styling (via a CDN link, since it’s outside of the Next.js build). It also uses Chart.js for graphs. Chart palette colors are sourced from CSS variables in `public/shared-styles.css` (`--chart-*-hex`), allowing easy theme tweaks.

Key implementation details: - The interface and logic are defined in the static files (e.g., index.html, main.js, and various JS modules under CalorieTracker/). - It connects to Firebase by including Firebase SDK scripts. The Firebase configuration (API keys, etc.) is defined in public/tools/CalorieTracker/firebaseConfig.js. - It supports **authentication**: users can sign up with email/password or use an anonymous guest mode. This is handled by Firebase Auth (likely via the Firebase script, not a custom UI like the Trip Cost tool has). - User data (like the log of entries, saved foods, targets) is stored in Firestore under a structured path, probably something like:

artifacts/  
calorie-tracker/  
users/{userId}/entries/{entryId} # daily entries  
users/{userId}/foods/{foodId} # saved custom foods  
users/{userId}/targets/... # user’s nutrition targets

(The exact structure can be found by inspecting the static code, but the idea is each user has their own data space.)

- The app features a number of modules to separate concerns:
- **State Management:** state/store.js acts as a central store for the app’s state (current user, current date, cached entries and foods, etc.).
- **UI Helpers:** utils/ui.js provides helper functions for updating the UI (like showing notifications or errors).
- **Event Wiring:** events/wire.js attaches event listeners to buttons and form inputs once the DOM is loaded, wiring up user interactions to the logic.
- **Data Handling:** services/data.js deals with fetching and saving data to Firestore (for example, loading all entries for the current user, or saving a new food item).
- **Firebase Service:** services/firebase.js initializes the Firebase app (using config) and sets up references to the Firestore database and Auth service.
- **Chart Management:** ui/chart.js sets up the Chart.js charts for visualizing intake over time. It takes data from the entries and plots daily calories (and possibly macro breakdown).
- **Parsing:** staging/parser.js is responsible for taking a blob of text (like multiple food entries copied at once) and parsing it into structured data that can be added to the log. This enables the "Paste to Stage" functionality, where users can import a list of foods in one go.
- **Food Management:** There are modules like food/manager.js and food/dropdown.js that handle adding new foods and managing the dropdown search for food names.

**Using the Calorie Tracker:** - When you open the page, if not logged in, it might prompt to log in or continue as guest. - Once you have a user session, you can pick a date (defaults to today) and start logging foods. - You can also add foods to a "saved foods" list for quick access (with their nutrition info). - The app calculates totals per day and compares them to your target. It can show average intake over the last 3 or 7 days on the chart. - The chart can be toggled between different nutrients (calories, protein, etc.) and different time spans (weekly, monthly view). - Because all data is stored in Firestore, you can come back later or use a different device and your data will be there (when logged into the same account).

**Integration with the main site:** The Tools page in the Next.js app describes this tool and provides the link. But once you click the link, you are essentially running a standalone app. There is a link or button on the Calorie Tracker interface (usually a home icon or "Back") which navigates back to the main site’s hub or Tools page.

**Note:** The Firebase config for this tool is embedded in the JavaScript. If you fork this project, you’d replace those with your own project’s keys. Also, ensure your Firebase security rules restrict data access by user (so users can’t read each other’s data).

### Social Security Benefits Guide

_“Learn how benefits and earnings interact through simulations.”_

This is an interactive guide that explains U.S. Social Security benefits, with some calculators or simulators embedded. It’s a static project located at **public/tools/social-security/** (accessed via /tools/social-security/index.html).

Features: - Provides educational content on Social Security (likely with multiple sections or pages in one HTML). - Includes interactive simulations where users can input values (like future earnings, retirement age) and see results. - Uses Tailwind CSS for styling and Chart.js for any charts/graphs in the simulations. - May have multiple HTML files or just one page with interactive elements.

This tool is largely informational, helping users understand how their earnings and retirement age might affect their benefits. It is self-contained in the static files.

### Social Security Benefits Calculator

_“Visualize the financial impact of different claiming strategies.”_

This is a related tool (also static) found at **public/tools/social-security-calculator/** (accessible via /tools/social-security-calculator/index.html). It appears to be a planner or calculator for Social Security, focusing on comparing different scenarios: - Users can adjust parameters such as retirement age (claiming age), life expectancy, investment return rates, etc. - It then produces charts or graphs showing outcomes for different claiming strategies (for example, claiming at 62 vs 67 vs 70 and how total benefits accumulate over time). - Likely uses Chart.js to plot financial balances over time, possibly highlighting break-even points where one strategy surpasses another.

This tool complements the Social Security guide by providing a more hands-on calculator for planning.

Both Social Security tools are static like the Calorie Tracker, so they are integrated similarly: the Tools page lists them and links to their static content. Each of these pages includes navigation back to the main site.

The Tools section is designed to be **extensible**. Some tools (like Trip Cost) are fully interactive React apps within Next.js, while others (like Calorie Tracker and the Social Security tools) are static standalone apps. The site supports both approaches seamlessly.

When adding a new tool, one decides whether it should be a static project in /public/tools or a React page under /app/tools. Static is simpler for self-contained projects, whereas the React approach is better if you need tight integration with the site or server-side capabilities.

## Trips Section (Travel Logs)

The **Trips** section is where travel-related content lives – for example, travel itineraries, photo journals, or trip blog posts. The main Trips page (/trips, generated by app/trips/page.tsx) lists available trip write-ups or itineraries with a title, description, and link (again similar in style to Games/Tools pages).

Currently it includes:

### Chicago Trip Itinerary

_“An itinerary for a trip to Chicago (Static HTML).”_

This is a detailed visual itinerary for a weekend trip to Chicago. It's a static page located at **public/trips/ChicagoTripItinerary/** with an entry point at /trips/ChicagoTripItinerary/index.html. The page outlines each day's schedule, attractions, and activities, likely in a timeline format.

Some details of this itinerary page: - It uses a timeline or schedule layout to display the plan for each day (morning, afternoon, evening slots with activities). - Activities might be categorized (e.g., Food, Sightseeing, Entertainment) with different colors or icons. - The HTML and CSS include elements for a timeline: possibly using a vertical timeline with times on the left and events on the right. - There might be interactive elements (the page includes Chart.js, possibly to show a visual schedule or budget breakdown). - The design uses Tailwind CSS classes and some custom CSS for layout. For example, it might use a grid for hourly slots and highlight blocks for each activity. - The itinerary could allow toggling views (maybe switching days or showing/hiding certain categories), indicated by some JavaScript logic.

From the user perspective, it’s a nicely formatted travel plan you can scroll through, possibly with images or maps for some entries.

As with games and tools, the Chicago itinerary page includes a link back to the main site (so travelers can navigate back to the Trips overview or home page easily).

In the future, the Trips section could include multiple types of content: - More **interactive itineraries** like the Chicago one, each as a static project under public/trips/&lt;TripName&gt;/. - **Narrative travel logs or photo journals** written in Markdown or MDX and rendered via Next.js. (For example, a story-like blog post about a trip, as opposed to a structured itinerary. These could be stored in /content/trips/ as markdown files and rendered with a dynamic MDX page.)

At the moment, to add a new trip entry, you would create the content (either as static HTML or MDX) and then update app/trips/page.tsx to include it in the list (tripList array) with a title, description, and link. That way it will appear on the Trips index page.

The site is already set up to allow adding Markdown content; we just haven’t implemented the automatic MDX integration. It would be relatively straightforward to add if needed (Next.js can be configured with @next/mdx to treat .mdx in app directory as pages, or use next-mdx-remote to load from content/).

## Adding New Content and Sections

One of the goals of this project is to make it easy to extend with new content. Here are guidelines for adding various types of content:

### Add a New Top-Level Section

If you want to introduce a new main category (similar to Games/Tools/Trips — for example, a "Blog" section or "Projects"), you can do so with these steps:

1. **Create the Section Page:** Create a new folder under app/ with the name of your section (e.g., app/blog/). Inside it, add a page.tsx file. This page should serve as the index/listing for that section (for instance, list all blog posts or present an introduction to the section).
2. **Add to Home Navigation:** Open the home page component (app/page.tsx). In the array of call-to-action links (ctaLinks or similar), add an entry for your new section with its href, label, and maybe an icon. This will make it appear as a card on the homepage alongside Games/Tools/Trips.
3. **Routes and Content:** If the section will contain multiple entries (like multiple blog posts or projects), decide how to structure them. You could use static files under public/&lt;sectionName&gt;/ or add subpages in your app/&lt;sectionName&gt;/ directory (for example, dynamic routes or multiple page files).
4. **Consistency:** Use a similar format to existing sections for design consistency. For example, if you add a Blog section, you might want an icon and a gradient style similar to the others. You can copy the styling approach from the other section cards for a uniform look and feel.

After doing this, you’ll have a new section accessible at /&lt;sectionName&gt; and linked from the homepage.

### Add a New Game or Tool (Static)

To add a standalone **game** or **tool** (one that is a separate HTML/JS app):

1. Build the game/tool as a self-contained front-end project (just like Noir Detective, Emeril, Calorie Tracker, etc.).
2. Place its entire folder in the appropriate subdirectory of **public** – for a game, use public/games/, for a tool, use public/tools/. The folder name will be used as the URL path.
3. Ensure the entry point file is named index.html (this is what the URL will load by default).
4. Once the files are in place, update the corresponding listing page in the Next.js app:
5. For a game: edit app/games/page.tsx. Add a new object to the gameList array with the game's name, a short description, and the href path to its index (e.g., href: '/games/your_game_folder/index.html'). Also choose an appropriate Lucide icon for the game (import it at the top and include it in the object).
6. For a tool: edit app/tools/page.tsx. Add a new object in the toolList array with name, description, and href: '/tools/your_tool_folder/index.html', plus an icon.
7. Test the link locally to make sure the static content loads correctly.

After this, the new game/tool will appear on the Games or Tools page, and users can click through to it. Remember to also include a link back to the main site _within the static project_ (as a convenience for navigation).

**Advanced (React-based Tool):** If your tool needs to be a richer React app or tightly integrated, you can create it under the Next.js app structure instead: - Make a new subdirectory under app/tools/ (e.g., app/tools/my-tool/). - Add a page.tsx and any needed components, following the pattern of trip-cost. - This approach is more complex but allows using React, Next.js features, and server-side logic if needed.

### Add a New Trip Log or Blog Post

For travel logs or blog-like content, you have two approaches:

**1\. Static HTML page:** If you want full control over layout and possibly interactivity (maps, custom JS), you can create it like the Chicago itinerary: - Make a new subfolder under public/trips/ (or public/blog/ or whichever section). - Add your index.html and any CSS/JS/images in that folder. - Update app/trips/page.tsx (or the relevant section page) to include it in the listing (title, description, and link to the index.html). - Provide navigation in your HTML page to go back (could be a simple link back to /trips or home).

**2\. Markdown/MDX page:** If the content can be mostly static text and images (like a blog post or a narrative), you can write it in Markdown: - Create a new markdown file in content/trips or content/blog (depending on section). For example, content/trips/2024-italy.md or content/blog/my-post.mdx. - There isn’t an out-of-the-box setup in this project for MDX yet, but you could integrate an MDX plugin. Alternatively, you might manually import the markdown content in a page. - Typically, you’d add a dynamic route page in app/trips/\[slug\]/page.tsx that reads the content file and renders it. Or use a library like next-mdx-remote to load and render the MDX content at build time. - Also update the listing page (app/trips/page.tsx) to include a link to this new entry (e.g., href: /trips/2024-italy if you set up a dynamic route by slug).

Using Markdown would let non-technical users (or just faster editing) to write trip reports or blog posts without dealing with HTML structure. But it requires a bit of setup (parsing MDX). For now, the project leans on static HTML for maximum flexibility in design.

### Organizing & Linking Content

Whenever you add new content, ensure that navigation is in place: - **Listings:** Add it to the relevant section page list (so users can find it). - **Back links:** On the content itself, include a link back to the parent section or home. (In static HTML, this could be a fixed top nav or even a simple “← Back to Trips” link.) - **Home page:** If it's a new main section, update the homepage with a card for it.

Consistency in naming and URL paths is important. For example, use kebab-case or snake_case for folder names in public (the site currently has examples like CalorieTracker with camel-case which works but consistency is nicer). And ensure the href in the Next.js page exactly matches the folder name.

By following these practices, new content will fit seamlessly into the site structure.

## Development Setup (Getting Started)

If you want to run the project locally or work on it:

### 1\. Install Dependencies

Make sure you have Node.js (v18+ recommended for Next.js 15). After downloading/cloning this repository, install the NPM packages:

npm install

This will fetch all required dependencies as listed in package.json, including Next.js, React, Tailwind, etc.

### 2\. Run the Development Server

Start the Next.js development server:

npm run dev

This will launch the app on a local server (usually <http://localhost:3000>). Open that URL in your browser to view the site locally. The site will auto-reload as you make changes to the code.

While developing, you can modify the Next.js pages (in /app) and see the updates live thanks to Hot Reload. For changes in static files under /public, you'll typically need to refresh the page where that content is loaded.

### 3\. Firebase Setup (if needed)

Some tools (Trip Cost, Calorie Tracker) use Firebase. For full functionality: - Create a free Firebase project. - Enable Email/Password authentication (for Trip Cost and Calorie Tracker). - Create a Cloud Firestore database. - You might need to set Firestore rules as mentioned in the earlier **Trip Cost** notes, to allow appropriate access. - Update the Firebase configuration in the code (for Trip Cost, in firebaseConfig.ts; for Calorie Tracker, in firebaseConfig.js) with your project's details. - If you don't do this, the site will still run, but those specific tools might not work correctly (or at all).

### 4\. Environment Variables

If using any secrets or keys (though in this project, most keys are client-side), you can define them in a .env.local file. For example, if you wanted to store Firebase API keys or an admin email outside of the code, you could set NEXT_PUBLIC_FIREBASE_API_KEY=... in .env.local and adjust the code to read from process.env.NEXT_PUBLIC_FIREBASE_API_KEY. Next.js will expose variables prefixed with NEXT_PUBLIC_ to the client-side.

### 5\. Linting & Formatting

There are NPM scripts for linting. You can run:

npm run lint

to check for code style issues with ESLint. The project uses a mostly default Next.js/React lint configuration.

Formatting (Prettier) can be run or set up in your editor for consistent code style.

## Deployment

The project is configured for deployment on **Cloudflare Pages**. Cloudflare Pages provides excellent support for Next.js (including the newer App Router).

**Steps to deploy on Cloudflare Pages:**

- Push your code to a Git repository (e.g., GitHub).
- In Cloudflare Pages dashboard, create a new project connected to your repo.
- Use the **Next.js build preset** if available. If not, manually set the build command to npm run build and the build output directory to .vercel/output (for Next 13+ apps) or .next (for older versions). Cloudflare’s preset should handle this for Next 15.
- Set environment variables on Cloudflare Pages if needed (e.g., any NEXT_PUBLIC_... vars or Firebase config, though if you baked those into the code, it's not necessary).
- Trigger a deploy. Cloudflare will install dependencies, build the Next.js app, and deploy the site.

Because our site is mostly static and uses Cloudflare’s infrastructure, it should load quickly and handle traffic easily. The static assets in /public will be served directly. Any Next.js server-side rendering (if we had any) would also be handled by Cloudflare’s adapters, but currently the app pages are either static or client-rendered.

**Note on Firebase with Cloudflare Pages:** Since Firebase is entirely client-side here, we don’t need special server config. Just ensure your Firebase rules allow the Cloudflare Pages domain (if you locked rules to specific referrers, for instance).

Once deployed, updates to the main branch (or whichever branch is configured) will automatically trigger redeployments, keeping the live site up-to-date.

## Guide for AI and Automated Contributors

This section is meant for any AI bots or coding assistants that might be tasked with extending or maintaining the site. It provides guidelines to ensure they interact with the codebase correctly and maintain consistency.

### Understand the Structure

The site has distinct areas for Next.js pages (/app) versus static content (/public). Determine where your change fits. For example, if asked to create a new interactive page that needs React or server-side rendering, work under /app. If adding a self-contained tool or document, add it under /public and link it appropriately from a page in /app. Refer to the **Project Structure** section above as a map of where things belong.

### Adding a New Section

When creating a new top-level section, remember to do all of the required steps (as detailed in **Adding New Content** above): - Create the section folder and page under app/. - Add the section card/link on the home page (app/page.tsx). - Use a similar format and styling to existing sections for consistency (for example, include an icon from lucide-react, and use the same card layout with hover effects). - If the section will have static files or markdown content, prepare the public/&lt;sectionName&gt;/ or content/&lt;sectionName&gt;/ directories as needed.

Be mindful of the design consistency – new additions should feel like part of the same site.

### Adding Items to a List

If adding a new game/tool/trip entry: - Place the static files in the correct public/ subfolder (if applicable). - Update the corresponding Next.js page (app/games/page.tsx, app/tools/page.tsx, or app/trips/page.tsx): - Add a new object to the array (gameList, toolList, or tripList) with the name, description, icon, and link. - Follow the JSON structure already used by other entries. - Double-check that the href path is correct (it should match the folder name and index.html of your static content). - Maintain the ordering logic. Currently, items are just listed in the order they appear in the array (not automatically sorted), so decide where to insert the new item (e.g., could be at the end or alphabetically, depending on context).

After adding, test the link to ensure it loads the intended content.

### Maintain Navigation

If an AI or script creates a new HTML page (e.g., a new game or trip itinerary in public), it **must** include a navigation link back to the main site. A simple example is adding at the top of the HTML: &lt;a href="/"&gt;← Back to Home&lt;/a&gt; or a link back to the section (like /games or /trips). Look at existing static pages for examples (they usually have a “Back” link or home icon).

This ensures users don’t get stuck on a standalone page with no way to navigate the rest of the site. It also helps search engines crawl back to the main site.

### Coding Style and Consistency

Adhere to the conventions used in this codebase: - **TypeScript & React:** Use TypeScript for any new React components or Next.js pages. Follow patterns from existing components (functional components with hooks, context usage, etc.). - **“use client” directive:** If you create a new interactive component or page in the Next.js App Router, add 'use client'; at the top if it needs to run on the client (many of our pages like the listing pages are client components due to use of dynamic data/icons). - **Tailwind CSS:** Use Tailwind classes for styling in JSX, consistent with the rest of the site’s look. We have a dark theme enabled (data-theme="dark" on &lt;html&gt; maybe) and use lots of utility classes for spacing, colors, typography. Try to reuse classes and follow the design system (see the Style Guide page for reference on colors, font sizes, etc.). - **File Naming:** Name files and components clearly. Use PascalCase for React components (e.g., NewTool.tsx) and lowercase for page file names or directories. Keep naming consistent (avoid using completely different naming schemes for similar things).

Before committing changes, it’s good to run the dev server and the linter to catch any issues.

### Testing Changes

After making changes (especially via automation), verify that: - The site builds without errors (npm run build). - The development server runs and the key pages load without runtime errors. - The new content is accessible via the intended path and looks/behaves as expected. - No existing functionality is broken (e.g., check the homepage, navigation links, and an existing game/tool page).

If the project has or will have automated tests, run them. Currently, this project doesn’t have a test suite, so manual testing is important.

In essence, any AI agent should mimic the patterns already present in the repository. For example, if tasked to "add a new calculator tool," the bot should either create it as a static tool under public/tools/ with an entry in app/tools/page.tsx, or if more complex, scaffold a new React-based tool under app/tools/new-tool/ similar to how **Trip Cost** is structured. When uncertain, it helps to search within the repository for examples (such as how "CalorieTracker" or "trip-cost" are implemented) and mirror those approaches.

### Keep Documentation Up-to-Date

Whenever changes or additions are made to the codebase, make sure to update this README accordingly. Whether it's a human developer or an AI assistant making the changes, the documentation should reflect the new state of the project. This practice keeps the project easy to understand and maintain for everyone.