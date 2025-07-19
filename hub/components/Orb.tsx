"use client"
import { motion } from 'framer-motion'
import type { Transition } from 'framer-motion'
import type { CSSProperties } from 'react'

// --- Configuration -----------------------------------------------------------
const CONFIG = {
  sizes: { sm: 40, md: 64, lg: 96 }
}

export const popSpring: Transition = {
  type: 'spring',
  mass: 0.7,
  stiffness: 180,
  damping: 20
}

export interface OrbProps {
  label: string
  size?: keyof typeof CONFIG.sizes
  onSelect?: () => void
  style?: CSSProperties
}

export default function Orb({ label, size = 'md', onSelect, style }: OrbProps) {
  const dim = CONFIG.sizes[size]
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onSelect}
      className="orb flex items-center justify-center rounded-full text-white bg-neonPink glow"
      style={{ width: dim, height: dim, ...style }}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.95 }}
      transition={popSpring}
    >
      {label}
    </motion.button>
  )
}
