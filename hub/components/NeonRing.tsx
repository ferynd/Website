'use client'
import { motion } from 'framer-motion'
import type { HubCategory } from '../lib/getHubData'

// --- Configuration ------------------------------------------------------------
const CONFIG = {
  radius: 120,           // Distance from center to ring center in pixels
  size: 60               // Diameter of each ring
}

export interface NeonRingProps {
  category: HubCategory
  index: number
  total: number
  isDimmed: boolean
  setActive: (i: number | null) => void
}

export default function NeonRing({
  category,
  index,
  total,
  isDimmed,
  setActive
}: NeonRingProps) {
  const theta = (index / total) * 2 * Math.PI
  const x = Math.cos(theta) * CONFIG.radius
  const y = Math.sin(theta) * CONFIG.radius

  return (
    <motion.button
      type="button"
      aria-label={category.name}
      className="absolute rounded-full border-2 border-pink-500 text-white"
      style={{
        width: CONFIG.size,
        height: CONFIG.size,
        left: `calc(50% + ${x}px - ${CONFIG.size / 2}px)`,
        top: `calc(50% + ${y}px - ${CONFIG.size / 2}px)`
      }}
      onHoverStart={() => setActive(index)}
      onHoverEnd={() => setActive(null)}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      animate={{ opacity: isDimmed ? 0.3 : 1 }}
      layoutId={`ring-${index}`}
    >
      {category.name}
    </motion.button>
  )
}
