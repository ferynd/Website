import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Tailwind paths, semantic colors, and plugins   */
/* ------------------------------------------------------------ */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg))',
        border: 'hsl(var(--border))',
        surface: {
          1: 'hsl(var(--surface-1))',
          2: 'hsl(var(--surface-2))',
          3: 'hsl(var(--surface-3))',
        },
        text: {
          DEFAULT: 'hsl(var(--text))',
          2: 'hsl(var(--text-2))',
          3: 'hsl(var(--text-3))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          600: 'hsl(var(--accent-600))',
        },
        magenta: 'hsl(var(--magenta))',
        purple: 'hsl(var(--purple))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        error: 'hsl(var(--error))',
        info: 'hsl(var(--info))',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        glow: 'var(--shadow-glow)',
      },
      borderRadius: {
        xl2: 'var(--radius-xl2)',
        xl3: 'var(--radius-xl3)',
      },
      maxWidth: {
        content: '72rem',
      },
      screens: {
        '3xl': '1720px',
      },
      fontFamily: {
        sans: ['var(--font-poppins)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [forms, typography],
};

export default config;
