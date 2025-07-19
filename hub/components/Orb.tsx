"use client"
import { motion } from "framer-motion"

type Kind = "folder" | "link"

export function Orb({ label, kind, onSelect, layoutId, style }: { label: string; kind: Kind; onSelect: () => void; layoutId?: string; style?: React.CSSProperties }) {
  const base = kind === "link" ? "rounded-xl" : "rounded-full"
  return (
    <motion.button
      layoutId={layoutId}
      style={style}
      aria-label={label}
      className={`${base} w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center font-medium text-neonBlue shadow-[0_0_8px_3px_theme(colors.neonBlue/0.7)] relative before:absolute before:inset-0 before:rounded-inherit before:blur-lg before:bg-neonBlue/60`}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.95 }}
      onClick={onSelect}
    >
      {label}
    </motion.button>
  )
}
