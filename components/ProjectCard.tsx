/* ------------------------------------------------------------ */
/* CONFIGURATION: default link target for project cards         */
/* ------------------------------------------------------------ */
const defaultHref = '#';

type Props = { title: string; description: string; tags?: string[]; href?: string; imageUrl?: string };

export default function ProjectCard({ title, description, tags = [], href = defaultHref, imageUrl }: Props) {
  return (
    <a href={href} className="group block rounded-xl3 overflow-hidden border border-border bg-surface-1 shadow-1 transition duration-200 ease-linear hover:shadow-2 hover:shadow-glow focus-ring">
      {imageUrl && (
        <div className="aspect-[16/9] overflow-hidden">
          <img src={imageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        </div>
      )}
      <div className="p-5">
        <h3 className="text-2xl font-semibold mb-1">{title}</h3>
        <p className="text-text-2">{description}</p>
        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-[12px] text-text-2 group-hover:border-accent">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}
