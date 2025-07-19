/**
 * Tailwind configuration for the hub
 *
 * Manual settings – adjust here if file locations or animation timings change
 */
import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

const CONFIG = {
  contentPaths: [
    './app/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  glowDuration: '1.8s',
  pulseDuration: '1.6s'
}

const config: Config = {
  content: CONFIG.contentPaths,
  theme: {
    extend: {
      colors: {
        neonBlue: '#3ab4ff',
        neonBlueDark: '#1577ff',
        neonPink: '#ff48fb'
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
        },
        orbPulse: {
          '0%': { opacity: 0.9 },
          '50%': { opacity: 1 },
          '100%': { opacity: 0.9 }
        }
      },
      animation: {
        'neon-glow': `glow ${CONFIG.glowDuration} ease-in-out infinite`,
        'neon-pulse': `pulse ${CONFIG.pulseDuration} ease-in-out infinite`,
        'orb-pulse': 'orbPulse 2s ease-in-out infinite'
      }
    }
  },
  plugins: [
    plugin(function ({ addUtilities }) {
      addUtilities({
        '.glow': { '@apply animate-neon-glow': {} },
        '.pulse': { '@apply animate-neon-pulse': {} },
        '.bg-gradient-radial': {
          background:
            'radial-gradient(circle at center, #1e293b 0%, #0f172a 60%, #000 100%)'
        }
      })
    })
  ]
}

export default config
