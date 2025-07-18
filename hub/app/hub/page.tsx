import HubCanvas from '../../components/HubCanvas'
import { getHubData } from '../../lib/getHubData'

export const dynamic = 'force-static'

export default async function HubPage() {
  const categories = await getHubData()
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <HubCanvas categories={categories} />
    </div>
  )
}
