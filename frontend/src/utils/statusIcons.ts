import type { StatusIconSet } from '../types/instance'

export type StatusIconKey =
  | 'queued'
  | 'processing'
  | 'chunked'
  | 'complete'
  | 'failed'
  | 'loading'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'

const ICONS: Record<StatusIconSet, Record<StatusIconKey, string>> = {
  classic: {
    queued: 'o',
    processing: '~',
    chunked: ':',
    complete: '*',
    failed: 'x',
    loading: 'o',
    success: '+',
    warning: '!',
    error: 'x',
    info: 'i',
  },
  minimal: {
    queued: '.',
    processing: '>',
    chunked: '#',
    complete: 'v',
    failed: 'x',
    loading: 'o',
    success: 'v',
    warning: '!',
    error: 'x',
    info: 'i',
  },
  playful: {
    queued: '*',
    processing: '~',
    chunked: '+',
    complete: 'y',
    failed: 'x',
    loading: '@',
    success: '+',
    warning: '!',
    error: 'x',
    info: '?',
  },
}

export function getStatusIcon(set: StatusIconSet, key: StatusIconKey): string {
  return ICONS[set]?.[key] ?? ICONS.classic[key]
}
