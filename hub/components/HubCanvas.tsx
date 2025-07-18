'use client'
import { useState } from 'react'
import { LayoutGroup, motion } from 'framer-motion'
import type { HubCategory } from '../lib/getHubData'
import CoreOrb from './CoreOrb'
import NeonRing from './NeonRing'

// --- Configuration ------------------------------------------------------------
const CONFIG = {
  canvasSize: 300 // Square size of the canvas in pixels
}

export interface HubCanvasProps {
  categories: HubCategory[]
}

export default function HubCanvas({ categories }: HubCanvasProps) {
  const [active, setActive] = useState<number | null>(null)

  return (
    <motion.div
      className="relative mx-auto"
      style={{ width: CONFIG.canvasSize, height: CONFIG.canvasSize }}
    >
      <LayoutGroup id="hub-rings">
        <CoreOrb />
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
      </LayoutGroup>
    </motion.div>
  )
}
