'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { HubCategory } from '../lib/getHubData'

export default function HubClient({ categories }: { categories: HubCategory[] }) {
  return (
    <main className="space-y-4">
      {categories.map((cat) => (
        <CategoryBand key={cat.slug} category={cat} />
      ))}
    </main>
  )
}

function CategoryBand({ category }: { category: HubCategory }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border rounded bg-gray-50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center p-4 font-semibold"
      >
        <span>
          {category.name}
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
              {category.links.map((item) => (
                <li
                  key={item.url}
                  className="bg-white rounded-lg shadow transition-transform hover:-translate-y-1 hover:shadow-lg list-none"
                >
                  <a href={item.url} className="block p-4 text-blue-600 font-bold">
                    {item.title}
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
