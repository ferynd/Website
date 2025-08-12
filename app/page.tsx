import Nav from '@/components/Nav';
import ProjectCard from '@/components/ProjectCard';

/* ------------------------------------------------------------ */
/* CONFIGURATION: featured projects shown on the home page      */
/* ------------------------------------------------------------ */
const featuredProjects = [
  { title: 'Game Prototype', description: 'Fast-paced browser game built with React + Canvas.', tags: ['React','Game','WebGL'], imageUrl: '/images/game.jpg' },
  { title: 'Automation Tool', description: 'CLI + dashboard to streamline workflows.', tags: ['Next.js','API','CLI'], imageUrl: '/images/tool.jpg' },
  { title: 'Data Viz', description: 'Interactive charts with polished interactions.', tags: ['D3','Charts','UX'], imageUrl: '/images/viz.jpg' },
];

export default function Home() {
  return (
    <main>
      <Nav />

      {/* Hero */}
      <section className="relative isolate">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40%_40%_at_60%_20%,_hsl(var(--accent)/0.25)_0%,_transparent_60%),radial-gradient(30%_30%_at_30%_70%,_hsl(var(--purple)/0.18)_0%,_transparent_60%)]" />
        <div className="mx-auto max-w-content px-4 sm:px-6 lg:px-8 py-28 sm:py-36">
          <h1 className="text-[clamp(2.5rem,6vw,4.25rem)] font-semibold tracking-tight">Projects, games, and experiments</h1>
          <p className="mt-4 max-w-2xl text-text-2">A polished playground for things I am building and breaking. Clean UI, strong contrast, neon accents.</p>
          <div className="mt-8 flex gap-4">
            <a href="#projects" className="rounded-xl3 bg-accent text-black px-6 py-3 font-medium shadow-glow transition hover:brightness-110 focus-ring">View projects</a>
            <a href="#about" className="rounded-xl3 border border-border text-text-2 px-6 py-3 transition hover:border-accent hover:text-text focus-ring">About me</a>
          </div>
        </div>
      </section>

      {/* Featured projects */}
      <section id="projects" className="py-16 sm:py-20">
        <div className="mx-auto max-w-content px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-semibold">Featured projects</h2>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredProjects.map((project) => (
              <ProjectCard key={project.title} {...project} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
