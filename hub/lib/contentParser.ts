import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'

// --- Configuration -----------------------------------------------------------
// Root directory that holds the hub markdown content
const HUB_ROOT = path.resolve(process.cwd(), '../content/hub')

export interface ContentNode {
  id: string
  type: 'folder' | 'page'
  label: string
  slug?: string
  children?: ContentNode[]
}

// Recursively parse a folder and return its node representation
async function parseFolder(dirPath: string): Promise<ContentNode> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

  // folder defaults based on directory name
  let label = path.basename(dirPath)
  let slug = path.basename(dirPath)

  // check for index.md to override metadata
  const indexFile = entries.find(e => e.isFile() && e.name === 'index.md')
  if (indexFile) {
    const raw = await fs.readFile(path.join(dirPath, 'index.md'), 'utf8')
    const { data } = matter(raw)
    label = data.label ?? data.title ?? label
    slug = data.slug ?? slug
  }

  const children: ContentNode[] = []
  for (const entry of entries) {
    if (entry.name === 'index.md') continue
    const full = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      children.push(await parseFolder(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const raw = await fs.readFile(full, 'utf8')
      const { data } = matter(raw)
      const pageLabel = data.title ?? entry.name.replace(/\.md$/, '')
      const pageSlug = data.url ?? data.slug ?? entry.name.replace(/\.md$/, '')
      children.push({
        id: path.relative(HUB_ROOT, full),
        type: 'page',
        label: pageLabel,
        slug: pageSlug,
      })
    }
  }

  return {
    id: path.relative(HUB_ROOT, dirPath) || slug,
    type: 'folder',
    label,
    slug,
    children,
  }
}

/**
 * Parse the hub content directory into a tree structure.
 */
export async function parseContentTree(rootDir: string = HUB_ROOT): Promise<ContentNode[]> {
  const items = await fs.readdir(rootDir, { withFileTypes: true })
  const nodes: ContentNode[] = []
  for (const item of items) {
    if (item.isDirectory()) {
      const dirPath = path.join(rootDir, item.name)
      nodes.push(await parseFolder(dirPath))
    }
  }
  return nodes
}
