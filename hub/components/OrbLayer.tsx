"use client"
import { AnimatePresence } from 'framer-motion'
import Orb from './Orb'

export interface OrbItem {
  key: string
  label: string
}

export interface OrbLayerProps {
  items: OrbItem[]
  radius: number
  onSelect: (key: string) => void
}

export default function OrbLayer({ items, radius, onSelect }: OrbLayerProps) {
  return (
    <AnimatePresence>
      {items.map((item, i) => {
        const theta = (i / items.length) * 2 * Math.PI
        const x = Math.cos(theta) * radius
        const y = Math.sin(theta) * radius
        return (
          <Orb
            key={item.key}
            label={item.label}
            style={{ position: 'absolute', left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}
            onSelect={() => onSelect(item.key)}
          />
        )
      })}
    </AnimatePresence>
  )
}
