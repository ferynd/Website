'use client'
import { motion } from 'framer-motion'

const SIZE = 80

export default function CoreOrb() {
  return (
    <motion.div
      aria-hidden
      className="rounded-full bg-neon-blue glow"
      style={{ width: SIZE, height: SIZE }}
      animate={{ scale: [1, 1.15, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}
