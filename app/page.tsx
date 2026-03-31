import Link from 'next/link';
import Nav from '@/components/Nav';

/* ------------------------------------------------------------ */
/* CONFIGURATION: hero call-to-action links                      */
/* ------------------------------------------------------------ */
const ctaLinks = [
  { href: '/games', label: 'Games' },
  { href: '/tools', label: 'Tools' },
  { href: '/trips', label: 'Trips' },
];

const featuredLinks = [
  {
    href: '/trips/JapanTrip.html',
    label: 'Open Japan Trip',
    description: 'Drop your file in /public/trips/JapanTrip.html and launch it from here.',
  },
];

export default function Home() {
  return (
    <main>
      <Nav />

      {/* Hero */}
      <section className="relative isolate">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40%_40%_at_60%_20%,_hsl(var(--accent)/0.25)_0%,_transparent_60%),radial-gradient(30%_30%_at_30%_70%,_hsl(var(--purple)/0.18)_0%,_transparent_60%)]" />
        <div className="container-tight py-28 sm:py-36">
          <h1 className="text-[clamp(2.5rem,6vw,4.25rem)] font-semibold tracking-tight">Projects, games, and experiments</h1>
          <p className="mt-4 max-w-2xl text-text-2">A polished playground for things I am building and breaking. Clean UI, strong contrast, neon accents.</p>
          <div className="mt-8 flex flex-wrap gap-4">
            {ctaLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  link.href === '/games'
                    ? 'rounded-xl3 bg-accent text-black px-6 py-4 font-medium shadow-glow transition-all duration-200 ease-in-out hover:brightness-110 focus-ring'
                    : 'rounded-xl3 border border-border text-text-2 px-6 py-4 transition-all duration-200 ease-in-out hover:border-accent hover:text-text focus-ring'
                }
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="mt-8 grid gap-3 sm:max-w-xl">
            {featuredLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-xl border border-border bg-surface-1 px-4 py-3 transition-all duration-200 ease-in-out hover:border-accent focus-ring"
              >
                <p className="text-sm font-semibold text-text">{link.label}</p>
                <p className="text-sm text-text-2">{link.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
