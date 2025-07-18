'use client'
import { motion } from 'framer-motion'

// --- Configuration ------------------------------------------------------------
const CONFIG = {
  size: 80,              // Base diameter of the orb
  pulseScale: 1.15,      // Maximum scale during pulse
  duration: 1.6          // Duration of one pulse cycle in seconds
}

export default function CoreOrb() {
  return (
    <motion.div
      aria-hidden
      className="rounded-full bg-blue-500 shadow-2xl"
      style={{ width: CONFIG.size, height: CONFIG.size }}
      animate={{ scale: [1, CONFIG.pulseScale, 1] }}
      transition={{ duration: CONFIG.duration, repeat: Infinity }}
    />
  )
}
