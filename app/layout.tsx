import './globals.css';
import { Poppins } from 'next/font/google';

/* ------------------------------------------------------------ */
/* CONFIGURATION: site metadata and font settings               */
/* ------------------------------------------------------------ */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300','400','500','600','700'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata = {
  title: 'James Berto • Projects & Games',
  description: 'Projects, games, and experiments.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className={`${poppins.variable} min-h-dvh bg-bg text-text`}>
        {children}
      </body>
    </html>
  );
}
