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
      className="rounded-full bg-neon-blue glow pulse"
      style={{ width: CONFIG.size, height: CONFIG.size }}
    />
  )
}
