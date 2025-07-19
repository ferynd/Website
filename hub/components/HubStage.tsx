"use client"
import { useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import useHubData from '../lib/useHubData'
import OrbLayer from './OrbLayer'
import Orb from './Orb'
import ParticleField from './ParticleField'

export default function HubStage() {
  const categories = useHubData()
  const [stack, setStack] = useState<string[]>(['hub'])

  const current = stack[stack.length - 1]

  const handleSelect = (key: string) => setStack([...stack, key])
  const handleBack = () => setStack(stack.slice(0, -1))

  let items: { key: string; label: string }[] = []
  let title = 'Hub'

  if (current === 'hub') {
    items = categories.map(c => ({ key: c.slug, label: c.name }))
  } else {
    const cat = categories.find(c => c.slug === current)
    if (cat) {
      title = cat.name
      items = cat.links.map(l => ({ key: l.url, label: l.title }))
    }
  }

  return (
    <div className="relative flex items-center justify-center h-screen bg-gradient-radial overflow-hidden">
      <ParticleField />
      <LayoutGroup>
        <AnimatePresence>
          {current !== 'hub' && (
            <motion.button
              key="back"
              type="button"
              onClick={handleBack}
              className="absolute top-4 left-4 text-white/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              &larr; Back
            </motion.button>
          )}
        </AnimatePresence>
        <Orb key={title} size="lg" label={title} />
        <OrbLayer items={items} radius={150} onSelect={handleSelect} />
      </LayoutGroup>
    </div>
  )
}
