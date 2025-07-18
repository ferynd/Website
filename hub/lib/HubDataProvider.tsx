import { loadHubData } from './loadHubData'
import type { HubCategory } from './getHubData'
import HubDataClientProvider from './HubDataClientProvider'

export default async function HubDataProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const data: HubCategory[] = await loadHubData()
  return (
    <HubDataClientProvider categories={data}>
      {children}
    </HubDataClientProvider>
  )
}
