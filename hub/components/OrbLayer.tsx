"use client"
import { AnimatePresence, motion } from "framer-motion"
import { Orb } from "./Orb"

export interface OrbItem {
  id: string
  label: string
  kind: "folder" | "link"
}

export function OrbLayer({
  items,
  radius,
  onSelect,
  dimmedIndex
}: {
  items: OrbItem[]
  radius: number
  onSelect: (item: OrbItem) => void
  dimmedIndex?: number | null
}) {
  return (
    <AnimatePresence>
      {items.map((item, i) => {
        const theta = (i / items.length) * 2 * Math.PI
        const x = Math.cos(theta) * radius
        const y = Math.sin(theta) * radius
        return (
          <motion.div
            key={item.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: dimmedIndex === undefined || dimmedIndex === i ? 1 : 0.2 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            style={{ position: "absolute", left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}
          >
            <Orb
              label={item.label}
              kind={item.kind}
              onSelect={() => onSelect(item)}
              layoutId={item.id}
            />
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}
