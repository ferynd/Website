// Utility to collect hub metadata from markdown files
import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'

// --- Configuration: adjust the root directory for hub content if needed ---
const HUB_CONTENT_DIR = path.resolve(process.cwd(), '../content/hub')

export interface HubLink {
  title: string
  url: string
  icon?: string
}

export interface HubCategory {
  slug: string
  name: string
  links: HubLink[]
}

/**
 * Read all markdown files under each directory in `content/hub` and
 * assemble a list of categories with their associated links.
 */
export async function getHubData(): Promise<HubCategory[]> {
  const dirs = await fs.readdir(HUB_CONTENT_DIR, { withFileTypes: true })
  const categories: HubCategory[] = []

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue

    const slug = dir.name
    const name = slug.charAt(0).toUpperCase() + slug.slice(1)
    const categoryDir = path.join(HUB_CONTENT_DIR, slug)
    const files = await fs.readdir(categoryDir)

    const links: HubLink[] = []
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const filePath = path.join(categoryDir, file)
      const content = await fs.readFile(filePath, 'utf8')
      const { data } = matter(content)
      links.push({
        title: data.title ?? file.replace(/\.md$/, ''),
        url: data.url ?? '#',
        icon: data.icon ?? ''
      })
    }

    categories.push({ slug, name, links })
  }

  return categories
}
