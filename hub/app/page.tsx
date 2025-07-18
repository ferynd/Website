import HubClient from './HubClient'
import { loadHubData } from '../lib/loadHubData'

export default async function Home() {
  const categories = await loadHubData()
  return (
    <div className="min-h-screen font-sans p-4 sm:p-8 mx-auto max-w-3xl">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold">Welcome to My Corner of the Web</h1>
      </header>
      <HubClient categories={categories} />
    </div>
  )
}
