import { getHubData, HubCategory } from './getHubData'
import { useJsonHubData } from '../next.config'
import fs from 'fs/promises'
import path from 'path'

export async function loadHubData(): Promise<HubCategory[]> {
  if (useJsonHubData) {
    const jsonPath = path.resolve(process.cwd(), '../content/hubConfig.json')
    const raw = await fs.readFile(jsonPath, 'utf8')
    return JSON.parse(raw) as HubCategory[]
  }
  return getHubData()
}
