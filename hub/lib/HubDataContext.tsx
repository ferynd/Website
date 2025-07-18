'use client'
import { createContext } from 'react'
import type { HubCategory } from './getHubData'

const HubDataContext = createContext<HubCategory[]>([])
export default HubDataContext
