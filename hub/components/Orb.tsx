"use client"
import { motion, useReducedMotion } from "framer-motion"

type Kind = "folder" | "link"

export function Orb({
  label,
  kind,
  onSelect,
  layoutId,
  style,
  url
}: {
  label: string
  kind: Kind
  onSelect: () => void
  layoutId?: string
  style?: React.CSSProperties
  url?: string
}) {
  const prefersReducedMotion = useReducedMotion()
  const base = kind === "link" ? "rounded-xl" : "rounded-full"
  const commonProps = {
    layoutId,
    style,
    "aria-label": label,
    className: `${base} w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center font-medium text-neonBlue shadow-[0_0_8px_3px_theme(colors.neonBlue/0.7)] relative before:absolute before:inset-0 before:rounded-inherit before:blur-lg before:bg-neonBlue/60`,
    whileHover: prefersReducedMotion ? { opacity: 0.8 } : { scale: 1.15 },
    whileTap: prefersReducedMotion ? { opacity: 0.6 } : { scale: 0.95 },
    transition: prefersReducedMotion ? { duration: 0.2 } : undefined
  }

  if (kind === "link") {
    return (
      <motion.a
        {...commonProps}
        href={url}
        onClick={e => {
          e.preventDefault()
          onSelect()
        }}
      >
        {label}
      </motion.a>
    )
  }

  return (
    <motion.button {...commonProps} onClick={onSelect}>
      {label}
    </motion.button>
  )
}
