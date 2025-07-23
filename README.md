My Website & Digital Garden

Welcome to my personal website project! This is a monorepo for all of my creative and technical projects, including games, tools, and travel logs. It's built with Next.js and Tailwind CSS for a modern, fast, and scalable experience.
Tech Stack

    Framework: Next.js (using the App Router)

    Language: TypeScript

    Styling: Tailwind CSS

    Deployment: Cloudflare Pages

Project Structure

This project uses a flat and organized structure to make finding and adding content intuitive.

    /app: Core Application & Pages. This is where all your website's routes and pages live. Each folder inside /app represents a URL segment.

        /app/page.tsx: The main landing page.

        /app/games/page.tsx: The main landing page for all your games.

        /app/tools/page.tsx: The main landing page for all your tools.

    /components: Reusable React Components. Any component used in more than one place (like buttons, cards, or navbars) should be stored here.

    /content: Markdown Content. This folder is for blog posts, articles, or any long-form content written in Markdown (.md or .mdx). The app can read these files to dynamically generate pages.

    /lib: Library & Helper Functions. A place for utility functions, helper scripts, and configurations (like your firebaseConfig.js).

    /public: Static Assets. This folder is the home for any file that needs to be accessed directly via a URL. This is the perfect place for:

        Your self-contained HTML/JS games and tools.

        Images, fonts, videos, and other static files.

        Example: A game in public/games/my-cool-game/ can be accessed at yourdomain.com/games/my-cool-game/index.html.

Getting Started
1. Install Dependencies

If you've just cloned the repo, you need to install all the required packages.

npm install

2. Run the Development Server

To start the local development server and see your site in action:

npm run dev

Open http://localhost:3000 with your browser to see the result.
How to Add Content
Adding a New Page or Category

    To create a new top-level category (e.g., /blog), simply create a new folder inside /app named blog and add a page.tsx file inside it.

Adding a New Standalone Game/Tool

    Place the entire folder for your game/tool (e.g., my-new-game) into the appropriate subfolder within /public (e.g., public/games/).

    You can then link to it directly from any page: <a href="/games/my-new-game/index.html">Play My New Game</a>.

Adding a New Blog Post / Trip Log

    Create a new .md or .mdx file in the /content/trips directory.

    The application can be configured to read these files and automatically create a page for each one.

Deployment

This project is configured for deployment on Cloudflare Pages. Simply connect your GitHub repository and select "Next.js" as the framework preset. Cloudflare will handle the build and deployment process automatically.