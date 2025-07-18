'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// --- Configuration ---
type SubItem = { name: string; href: string }
interface Category { id: string; icon: string; title: string; items: SubItem[] }

const categories: Category[] = [
  {
    id: 'trips',
    icon: '🌍',
    title: 'Trips',
    items: [{ name: 'Chicago Trip Itinerary', href: '/trips/ChicagoTripItinerary/' }],
  },
  {
    id: 'tools',
    icon: '🛠️',
    title: 'Tools',
    items: [{ name: 'Calorie Tracker', href: '/tools/CalorieTracker/' }],
  },
  {
    id: 'games',
    icon: '🎮',
    title: 'Games',
    items: [{ name: 'Noir Detective Idea', href: '/games/noir_detective_idea/' }],
  },
]

export default function Home() {
  return (
    <div className="min-h-screen font-sans p-4 sm:p-8 mx-auto max-w-3xl">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold">Welcome to My Corner of the Web</h1>
      </header>
      <main className="space-y-4">
        {categories.map((cat) => (
          <CategoryBand key={cat.id} category={cat} />
        ))}
      </main>
    </div>
  )
}

function CategoryBand({ category }: { category: Category }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border rounded bg-gray-50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center p-4 font-semibold"
      >
        <span>
          {category.icon} {category.title}
        </span>
        <span className="text-xl">{open ? '−' : '+'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden px-4"
          >
            <ul className="grid gap-4 py-4 sm:grid-cols-2">
              {category.items.map((item) => (
                <li
                  key={item.href}
                  className="bg-white rounded-lg shadow transition-transform hover:-translate-y-1 hover:shadow-lg list-none"
                >
                  <a href={item.href} className="block p-4 text-blue-600 font-bold">
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
