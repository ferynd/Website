'use client'
import { useState } from 'react'
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion'
import useHubData from '../lib/useHubData'
import CoreOrb from './CoreOrb'
import NeonRing from './NeonRing'

// --- Configuration ------------------------------------------------------------
const CONFIG = {
  canvasSize: 300 // Square size of the canvas in pixels
}

export default function HubCanvas() {
  const categories = useHubData()
  const [active, setActive] = useState<number | null>(null)

  return (
    <motion.div
      className="mx-auto flex flex-col items-center gap-4 sm:relative sm:block min-w-[48px] min-h-[48px]"
      style={{ width: CONFIG.canvasSize, height: CONFIG.canvasSize }}
    >
      <LayoutGroup id="hub-rings">
        <CoreOrb />
        <AnimatePresence>
          {categories.map((cat, i) => (
            <NeonRing
              key={cat.slug}
              category={cat}
              index={i}
              total={categories.length}
              isDimmed={active !== null && active !== i}
              setActive={setActive}
            />
          ))}
        </AnimatePresence>
      </LayoutGroup>
    </motion.div>
  )
}
