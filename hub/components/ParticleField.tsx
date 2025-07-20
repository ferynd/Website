"use client"
import { useCallback } from 'react'
import Particles from 'react-tsparticles'
import type { Engine } from 'tsparticles-engine'
import { loadSlim } from 'tsparticles-slim'

// --- Configuration -----------------------------------------------------------
const CONFIG = {
  count: 25 // number of particles
}

export default function ParticleField() {
  const init = useCallback(async (engine: Engine) => {
    await loadSlim(engine)
  }, [])

  return (
    <Particles
      id="particle-field"
      init={init}
      className="absolute inset-0 -z-10"
      options={{
        fullScreen: false,
        particles: {
          number: { value: CONFIG.count },
          opacity: { value: 0.3 },
          size: { value: { min: 1, max: 3 } },
          color: { value: '#fff' },
          move: { enable: true, speed: 0.2 }
        },
        interactivity: {
          events: {
            onHover: { enable: false },
            onClick: { enable: false }
          }
        }
      }}
    />
  )
}
