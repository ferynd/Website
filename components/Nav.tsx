'use client';
import Link from 'next/link';
import { useState } from 'react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: navigation labels                             */
/* ------------------------------------------------------------ */
const navLinks = ['Projects','Games','About','Contact'];

export default function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 backdrop-blur supports-[backdrop-filter]:bg-surface-2/80 border-b border-border">
      <nav className="mx-auto max-w-content flex items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold focus-ring">JB</Link>
        <button
          aria-label="Toggle menu"
          className="md:hidden p-2 rounded-lg border border-border hover:border-accent transition focus-ring"
          onClick={() => setOpen(!open)}
        >
          ☰
        </button>
        <ul className="hidden md:flex gap-6 text-text-2">
          {navLinks.map((label) => (
            <li key={label}>
              <Link className="hover:text-text transition focus-ring" href={`/#${label.toLowerCase()}`}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {open && (
        <div className="md:hidden border-t border-border bg-surface-2">
          <ul className="px-4 py-2 space-y-2">
            {navLinks.map((label) => (
              <li key={label}>
                <Link className="block py-2 text-text-2 hover:text-text focus-ring" href={`/#${label.toLowerCase()}`}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
