'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Button from '@/components/Button';

/* ------------------------------------------------------------ */
/* CONFIGURATION: navigation links & classes                    */
/* ------------------------------------------------------------ */
const navLinks = [
  { label: 'Games', href: '/games' },
  { label: 'Tools', href: '/tools' },
  { label: 'Trips', href: '/trips' },
  { label: 'Style Guide', href: '/style-guide' },
];

const linkBaseClass = 'transition-all duration-200 ease-in-out hover:text-text focus-ring';
const activeLinkClass = 'text-text font-medium';
const inactiveLinkClass = 'text-text-2';
const mobileMenuTransition =
  'transition-all duration-200 ease-in-out origin-top transform';

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-surface-2/80 border-b border-border shadow-sm">
      <nav className="container-tight flex items-center justify-between py-4">
        <Link href="/" className={`text-lg font-semibold ${linkBaseClass}`}>
          JB
        </Link>
        <Button
          aria-label="Toggle menu"
          aria-expanded={open}
          variant="ghost"
          size="sm"
          className="md:hidden p-4 border border-border hover:border-accent"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <ul className="hidden md:flex gap-6">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  className={`${linkBaseClass} ${isActive ? activeLinkClass : inactiveLinkClass}`}
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div
        className={`md:hidden border-t border-border bg-surface-2 overflow-hidden ${mobileMenuTransition} ${
          open
            ? 'scale-y-100 opacity-100'
            : 'scale-y-0 opacity-0 pointer-events-none'
        }`}
      >
        <ul className="px-4 py-4 space-y-4">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  className={`block py-4 ${linkBaseClass} ${isActive ? activeLinkClass : inactiveLinkClass}`}
                  href={link.href}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </header>
  );
}
