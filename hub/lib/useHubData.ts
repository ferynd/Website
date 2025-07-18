'use client'
import { useContext } from 'react'
import HubDataContext from './HubDataContext'

export default function useHubData() {
  return useContext(HubDataContext)
}
