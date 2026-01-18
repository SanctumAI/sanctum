export type FieldType = 'text' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'url'

export interface CustomField {
  id: string
  name: string
  type: FieldType
  required: boolean
  placeholder?: string
  options?: string[]  // for select type
}

export interface UserProfile {
  email: string
  name?: string
  completedAt: string
  fields: Record<string, string | boolean>  // fieldId -> value
}

// LocalStorage helpers
export const STORAGE_KEYS = {
  ADMIN_PUBKEY: 'sanctum_admin_pubkey',
  USER_EMAIL: 'sanctum_user_email',
  USER_NAME: 'sanctum_user_name',
  CUSTOM_FIELDS: 'sanctum_custom_fields',
  USER_PROFILE: 'sanctum_user_profile',
  PENDING_EMAIL: 'sanctum_pending_email',
  PENDING_NAME: 'sanctum_pending_name',
} as const

export function getCustomFields(): CustomField[] {
  const stored = localStorage.getItem(STORAGE_KEYS.CUSTOM_FIELDS)
  if (!stored) return []
  try {
    return JSON.parse(stored)
  } catch {
    return []
  }
}

export function saveCustomFields(fields: CustomField[]): void {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_FIELDS, JSON.stringify(fields))
}

export function getUserProfile(): UserProfile | null {
  const stored = localStorage.getItem(STORAGE_KEYS.USER_PROFILE)
  if (!stored) return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

export function saveUserProfile(profile: UserProfile): void {
  localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(profile))
}
