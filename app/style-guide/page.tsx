'use client';
import { useEffect, useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import ProjectCard from '@/components/ProjectCard';

/* ------------------------------------------------------------ */
/* CONFIGURATION: color tokens, button variants, spacing sizes  */
/* ------------------------------------------------------------ */
const colorTokens = [
  { name: '--bg', label: 'Background' },
  { name: '--surface-1', label: 'Surface 1' },
  { name: '--surface-2', label: 'Surface 2' },
  { name: '--surface-3', label: 'Surface 3' },
  { name: '--border', label: 'Border' },
  { name: '--text', label: 'Text' },
  { name: '--text-2', label: 'Text 2' },
  { name: '--text-3', label: 'Text 3' },
  { name: '--accent', label: 'Accent' },
  { name: '--accent-600', label: 'Accent 600' },
  { name: '--magenta', label: 'Magenta' },
  { name: '--purple', label: 'Purple' },
  { name: '--success', label: 'Success' },
  { name: '--warning', label: 'Warning' },
  { name: '--error', label: 'Error' },
  { name: '--info', label: 'Info' },
];

const buttonVariants = ['primary', 'secondary', 'danger', 'success', 'ghost'] as const;
const spacingSizes = ['1', '2', '4', '8', '16', '24', '32'];

export default function StyleGuidePage() {
  const [colors, setColors] = useState<{ name: string; label: string; value: string }[]>([]);

  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    const vals = colorTokens.map((token) => ({
      ...token,
      value: computed.getPropertyValue(token.name),
    }));
    setColors(vals);
  }, []);

  return (
    <div className="container-tight py-16 space-y-16">
      <section>
        <h2 className="text-3xl font-semibold mb-8">Colors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
          {colors.map((c) => (
            <div key={c.name} className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-lg border border-border"
                style={{ backgroundColor: `hsl(${c.value})` }}
              />
              <div>
                <div className="font-mono text-sm">{c.name}</div>
                <div className="text-text-2">{c.value.trim() || '–'}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-3xl font-semibold mb-8">Buttons</h2>
        {buttonVariants.map((variant) => (
          <div key={variant} className="mb-8">
            <h3 className="text-xl mb-4 capitalize">{variant}</h3>
            <div className="flex flex-wrap gap-4">
              <Button variant={variant}>Default</Button>
              <Button variant={variant} disabled>
                Disabled
              </Button>
              <Button variant={variant} loading>
                Loading
              </Button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-3xl font-semibold mb-8">Form Elements</h2>
        <div className="grid gap-8 sm:grid-cols-2">
          <Input label="Input" placeholder="Type here" />
          <Input label="Input Error" error="Invalid value" placeholder="Type here" />
          <Input label="Disabled" disabled placeholder="Disabled" />
          <Select label="Select">
            <option>Option A</option>
            <option>Option B</option>
          </Select>
          <Select label="Select Error" error="Required">
            <option>Option A</option>
            <option>Option B</option>
          </Select>
          <Select label="Disabled" disabled>
            <option>Option A</option>
          </Select>
        </div>
      </section>

      <section>
        <h2 className="text-3xl font-semibold mb-8">Cards</h2>
        <div className="grid gap-8 sm:grid-cols-2">
          <ProjectCard
            title="Project Alpha"
            description="A short description of Project Alpha."
            tags={['TypeScript', 'Next.js']}
          />
          <ProjectCard
            title="Project Beta"
            description="Another project card layout."
            tags={['Design', 'UI']}
          />
        </div>
      </section>

      <section>
        <h2 className="text-3xl font-semibold mb-8">Typography</h2>
        <div className="space-y-4">
          <h1 className="text-5xl font-bold">Heading 1</h1>
          <h2 className="text-4xl font-bold">Heading 2</h2>
          <h3 className="text-3xl font-semibold">Heading 3</h3>
          <h4 className="text-2xl font-semibold">Heading 4</h4>
          <p className="text-base">
            This is a paragraph demonstrating the default text style. Lorem ipsum dolor sit amet,
            consectetur adipiscing elit.
          </p>
          <small className="text-sm text-text-2">This is small muted text.</small>
        </div>
      </section>

      <section>
        <h2 className="text-3xl font-semibold mb-8">Spacing &amp; Sizing</h2>
        <div className="space-y-8">
          <div>
            <h3 className="text-xl mb-4">Padding Scale</h3>
            <div className="flex items-end gap-4">
              {spacingSizes.map((s) => (
                <div
                  key={`p-${s}`}
                  className="bg-accent text-black flex items-center justify-center"
                  style={{ padding: `${s}px` }}
                >
                  <span className="text-xs font-mono">p-{s}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xl mb-4">Square Sizes</h3>
            <div className="flex items-end gap-4">
              {spacingSizes.map((s) => (
                <div
                  key={`size-${s}`}
                  className="bg-surface-2 border border-border flex items-center justify-center"
                  style={{ width: `${Number(s) * 4}px`, height: `${Number(s) * 4}px` }}
                >
                  <span className="text-xs font-mono">{Number(s) * 4}px</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

