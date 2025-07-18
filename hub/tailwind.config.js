/**
 * Tailwind configuration for the hub
 *
 * Manual settings – adjust here if file locations or animation timings change
 */
const CONFIG = {
  contentPaths: [
    './app/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  glowDuration: '1.8s',
  pulseDuration: '1.6s'
}

const plugin = require('tailwindcss/plugin')

/** @type {import('tailwindcss').Config} */
const config = {
  content: CONFIG.contentPaths,
  theme: {
    extend: {
      colors: {
        'neon-blue': '#18ffff',
        'neon-pink': '#ff48fb'
      },
      keyframes: {
        glow: {
          '0%, 100%': {
            boxShadow:
              '0 0 4px currentColor, 0 0 8px currentColor, 0 0 12px currentColor'
          },
          '50%': {
            boxShadow:
              '0 0 8px currentColor, 0 0 16px currentColor, 0 0 24px currentColor'
          }
        },
        pulse: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.1)' }
        }
      },
      animation: {
        'neon-glow': `glow ${CONFIG.glowDuration} ease-in-out infinite`,
        'neon-pulse': `pulse ${CONFIG.pulseDuration} ease-in-out infinite`
      }
    }
  },
  plugins: [
    plugin(function ({ addUtilities }) {
      addUtilities({
        '.glow': { '@apply animate-neon-glow': {} },
        '.pulse': { '@apply animate-neon-pulse': {} }
      })
    })
  ]
}

module.exports = config
