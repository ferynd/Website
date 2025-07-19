import ParticleField from '../../components/ParticleField'
import HubStage from '../../components/HubStage'
import { getHubData } from '../../lib/getHubData'

export const dynamic = 'force-static'

export default async function HubPage() {
  const categories = await getHubData()
  return (
    <div className="relative h-screen bg-gradient-radial overflow-hidden">
      <ParticleField />
      <HubStage initialData={categories} />
    </div>
  )
}
