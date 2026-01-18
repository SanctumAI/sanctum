/**
 * Instance Configuration Context
 *
 * LIMITATION: Currently, instance settings (name, icon, accentColor) are stored
 * in browser localStorage only. This means:
 * - Settings are per-browser/device (not shared across users)
 * - Settings are lost if browser data is cleared
 *
 * TODO: Persist settings to SQLite backend so they're shared across all users.
 * When implemented, this context should:
 * - Fetch settings from GET /settings on mount
 * - Save settings to PATCH /settings on update
 * - Keep localStorage as a cache/fallback for offline use
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  InstanceConfig,
  DEFAULT_INSTANCE_CONFIG,
  getInstanceConfig,
  saveInstanceConfig,
  applyAccentColor,
} from '../types/instance'

interface InstanceConfigContextValue {
  config: InstanceConfig
  setConfig: (config: InstanceConfig) => void
  updateConfig: (updates: Partial<InstanceConfig>) => void
}

const InstanceConfigContext = createContext<InstanceConfigContextValue | undefined>(undefined)

export function InstanceConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<InstanceConfig>(DEFAULT_INSTANCE_CONFIG)

  // Load config on mount
  useEffect(() => {
    const stored = getInstanceConfig()
    setConfigState(stored)
    applyAccentColor(stored.accentColor)
  }, [])

  const setConfig = (newConfig: InstanceConfig) => {
    setConfigState(newConfig)
    saveInstanceConfig(newConfig)
    applyAccentColor(newConfig.accentColor)
  }

  const updateConfig = (updates: Partial<InstanceConfig>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
  }

  return (
    <InstanceConfigContext.Provider value={{ config, setConfig, updateConfig }}>
      {children}
    </InstanceConfigContext.Provider>
  )
}

export function useInstanceConfig(): InstanceConfigContextValue {
  const context = useContext(InstanceConfigContext)
  if (!context) {
    throw new Error('useInstanceConfig must be used within an InstanceConfigProvider')
  }
  return context
}
