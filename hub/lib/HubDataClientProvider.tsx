'use client'
import HubDataContext from './HubDataContext'
import type { HubCategory } from './getHubData'

export default function HubDataClientProvider({
  children,
  categories,
}: {
  children: React.ReactNode
  categories: HubCategory[]
}) {
  return (
    <HubDataContext.Provider value={categories}>
      {children}
    </HubDataContext.Provider>
  )
}
