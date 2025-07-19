import HubStage from '../components/HubStage'
import HubDataClientProvider from '../lib/HubDataClientProvider'
import { loadHubData } from '../lib/loadHubData'

export const dynamic = 'force-static'

export default async function Home() {
  const categories = await loadHubData()
  return (
    <HubDataClientProvider categories={categories}>
      <HubStage />
    </HubDataClientProvider>
  )
}
