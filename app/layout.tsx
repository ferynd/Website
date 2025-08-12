import "./globals.css";
import { Poppins } from "next/font/google";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300","400","500","600","700"],
  variable: "--font-poppins",
});

export const metadata = {
  title: "James Berto • Projects & Games",
  description: "A polished playground for projects, games, and experiments.",
  metadataBase: new URL("https://YOUR-DOMAIN.tld"),
  openGraph: {
    title: "James Berto • Projects & Games",
    description: "Projects, games, and experiments.",
    type: "website",
    url: "https://YOUR-DOMAIN.tld",
  },
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
