// Utility to collect hub metadata from markdown files
import { parseContentTree } from './contentParser'

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
  const tree = await parseContentTree()
  const categories: HubCategory[] = []
  for (const node of tree) {
    if (node.type !== 'folder') continue
    const slug = node.slug ?? node.id
    const links: HubLink[] = []
    for (const child of node.children ?? []) {
      if (child.type !== 'page') continue
      links.push({
        title: child.label,
        url: child.slug ?? '#',
        icon: ''
      })
    }
    categories.push({ slug, name: node.label, links })
  }
  return categories
}
