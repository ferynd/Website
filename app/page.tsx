import Link from 'next/link';
import { Gamepad2, Wrench, Plane, ArrowRight } from 'lucide-react';

// You can define your categories here for easy management
const categories = [
  {
    name: 'Games',
    description: 'Interactive projects and games built with code.',
    href: '/games',
    icon: <Gamepad2 size={32} className="mb-4 text-indigo-400" />,
    bgColor: 'from-gray-800 to-gray-900',
    borderColor: 'hover:border-indigo-500',
  },
  {
    name: 'Tools',
    description: 'Useful utilities and apps to solve problems.',
    href: '/tools',
    icon: <Wrench size={32} className="mb-4 text-green-400" />,
    bgColor: 'from-gray-800 to-gray-900',
    borderColor: 'hover:border-green-500',
  },
  {
    name: 'Trips',
    description: 'A collection of travel logs, photos, and stories.',
    href: '/trips',
    icon: <Plane size={32} className="mb-4 text-sky-400" />,
    bgColor: 'from-gray-800 to-gray-900',
    borderColor: 'hover:border-sky-500',
  },
];

export default function HomePage() {
  return (
    <div className="bg-gray-900 text-white min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600">
            James Digital Garden
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg sm:text-xl text-gray-400">
            A curated collection of projects, thoughts, and adventures. Explore what I&apos;ve been building and where I&apos;ve been.
          </p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Link href={category.href} key={category.name}>
              <div
                className={`group relative p-8 rounded-2xl bg-gradient-to-br ${category.bgColor} border border-gray-700 transition-all duration-300 ease-in-out ${category.borderColor} hover:shadow-2xl hover:shadow-purple-500/10 hover:-translate-y-1 cursor-pointer h-full flex flex-col`}
              >
                {category.icon}
                <h2 className="text-2xl font-bold text-gray-100">{category.name}</h2>
                <p className="mt-2 text-gray-400 flex-grow">{category.description}</p>
                <div className="mt-6 flex items-center text-indigo-400 font-semibold">
                  <span>Explore</span>
                  <ArrowRight size={20} className="ml-2 transition-transform duration-300 group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
