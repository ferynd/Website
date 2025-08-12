'use client';
import Link from 'next/link';
import { useState } from 'react';
import Button from '@/components/Button';

/* ------------------------------------------------------------ */
/* CONFIGURATION: navigation links                              */
/* ------------------------------------------------------------ */
const navLinks = [
  { label: 'Games', href: '/games' },
  { label: 'Tools', href: '/tools' },
  { label: 'Trips', href: '/trips' },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 backdrop-blur bg-surface-2/80 border-b border-border">
      <nav className="container-tight flex items-center justify-between py-3">
        <Link href="/" className="text-lg font-semibold focus-ring">
          JB
        </Link>
        <Button
          aria-label="Toggle menu"
          variant="ghost"
          size="sm"
          className="md:hidden p-2 border border-border hover:border-accent"
          onClick={() => setOpen(!open)}
        >
          {/* A more accessible and scalable approach would be to use an SVG icon here */}
          ☰
        </Button>
        <ul className="hidden md:flex gap-6 text-text-2">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                className="hover:text-text transition focus-ring"
                href={link.href}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {open && (
        <div className="md:hidden border-t border-border bg-surface-2">
          <ul className="px-4 py-2 space-y-2">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  className="block py-2 text-text-2 hover:text-text focus-ring"
                  href={link.href}
                  onClick={() => setOpen(false)} // Close menu on link click
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
