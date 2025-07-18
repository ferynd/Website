'use client'
import { useContext } from 'react'
import HubDataContext from './HubDataContext'

export default function useHubData() {
  const ctx = useContext(HubDataContext)
  if (ctx === null) {
    throw new Error('useHubData must be used within HubDataProvider')
  }
  return ctx
}
