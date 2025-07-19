'use client'
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion'
import useHubData from '../lib/useHubData'
import CoreOrb from './CoreOrb'
import { Orb } from './Orb'

// --- Configuration ------------------------------------------------------------
const CONFIG = {
  canvasSize: 300, // Square size of the canvas in pixels
  radius: 120 // distance from center to orb layer
}

export default function HubCanvas() {
  const categories = useHubData()

  return (
    <motion.div
      className="mx-auto flex flex-col items-center gap-4 sm:relative sm:block min-w-[48px] min-h-[48px]"
      style={{ width: CONFIG.canvasSize, height: CONFIG.canvasSize }}
    >
      <LayoutGroup id="hub-rings">
        <CoreOrb />
        <AnimatePresence>
          {categories.map((cat, i) => (
            <Orb
              key={cat.slug}
              label={cat.name}
              kind="folder"
              style={{
                position: 'absolute',
                left: `calc(50% + ${Math.cos((i / categories.length) * 2 * Math.PI) * CONFIG.radius}px)`,
                top: `calc(50% + ${Math.sin((i / categories.length) * 2 * Math.PI) * CONFIG.radius}px)`
              }}
              onSelect={() => null}
            />
          ))}
        </AnimatePresence>
      </LayoutGroup>
    </motion.div>
  )
}
