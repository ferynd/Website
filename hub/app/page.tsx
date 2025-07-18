import HubCanvas from '../components/HubCanvas'
import { loadHubData } from '../lib/loadHubData'

export const dynamic = 'force-static'
export default async function Home() {
  await loadHubData()
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <HubCanvas />
    </div>
  )
}

export async function generateStaticParams() {
  const categories = await loadHubData()
  return categories.map(cat => ({ category: cat.slug }))
}
