"use client"
import { useState } from "react"
import { AnimatePresence, LayoutGroup, motion } from "framer-motion"
import { useRouter } from "next/navigation"
import type { HubCategory } from "../lib/getHubData"
import { OrbLayer, OrbItem } from "./OrbLayer"
import { Orb } from "./Orb"

export default function HubStage({ initialData }: { initialData: HubCategory[] }) {
  const router = useRouter()
  const [layerStack, setLayerStack] = useState<string[]>(["hub"])
  const [animatingTo, setAnimatingTo] = useState<string | null>(null)

  const categories = initialData
  const currentKey = layerStack[layerStack.length - 1]

  function getItems(key: string): OrbItem[] {
    if (key === "hub") {
      return categories.map(c => ({ id: c.slug, label: c.name, kind: "folder" as const }))
    }
    const cat = categories.find(c => c.slug === key)
    if (!cat) return []
    return cat.links.map(l => ({ id: l.url, label: l.title, kind: "link" as const }))
  }

  function handleSelect(item: OrbItem) {
    if (item.kind === "link") {
      router.push(item.id)
      return
    }
    setAnimatingTo(item.id)
  }

  function handleAnimationComplete() {
    if (animatingTo) {
      setLayerStack([...layerStack, animatingTo])
      setAnimatingTo(null)
    }
  }

  const items = getItems(currentKey)
  const title = currentKey === "hub" ? "Hub" : categories.find(c => c.slug === currentKey)?.name || "Hub"

  const dimIndex = animatingTo ? items.findIndex(i => i.id === animatingTo) : null

  return (
    <LayoutGroup>
      <div className="relative h-full w-full flex items-center justify-center">
        <AnimatePresence>{layerStack.length > 1 && (
          <motion.button
            key="back"
            onClick={() => setLayerStack(layerStack.slice(0, -1))}
            className="absolute top-4 left-4 text-neonBlue"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            ← Back
          </motion.button>
        )}</AnimatePresence>
        <motion.div
          key={currentKey}
          className="absolute inset-0 flex items-center justify-center"
          onAnimationComplete={handleAnimationComplete}
        >
          <Orb label={title} kind="folder" onSelect={() => {}} layoutId={currentKey} />
          <OrbLayer items={items} radius={150} onSelect={handleSelect} dimmedIndex={dimIndex} />
        </motion.div>
      </div>
    </LayoutGroup>
  )
}
