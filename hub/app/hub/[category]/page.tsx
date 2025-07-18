import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadHubData } from '../../../lib/loadHubData'

export const dynamic = 'force-static'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function CategoryPage({ params }: any) {
  const { category: slug } = params as { category: string }
  const categories = await loadHubData()
  const category = categories.find(cat => cat.slug === slug)
  if (!category) return notFound()
  return (
    <div className="min-h-screen mx-auto max-w-3xl p-4">
      <header className="mb-8">
        <Link href="/" className="text-blue-600">&larr; Back</Link>
        <h1 className="text-2xl font-bold mt-2">{category.name}</h1>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {category.links.map(link => (
          <li key={link.url} className="bg-white rounded-lg shadow list-none">
            <a href={link.url} className="block p-4 hover:underline">
              {link.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export async function generateStaticParams() {
  const categories = await loadHubData()
  return categories.map(cat => ({ category: cat.slug }))
}
