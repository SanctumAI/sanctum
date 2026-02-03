export type FieldType = 'text' | 'email' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'url'

// User type - groups of users with different question sets
export interface UserType {
  id: number
  name: string
  description?: string
  display_order: number
}

export interface CustomField {
  id: string
  name: string
  type: FieldType
  required: boolean
  placeholder?: string
  options?: string[]  // for select type
  user_type_id?: number | null  // null = global field (shown for all types)
  encryption_enabled?: boolean  // true = encrypt field values (secure default)
  include_in_chat?: boolean  // true = include field value in AI chat context (only for unencrypted fields)
}

export interface UserProfile {
  email: string
  name?: string
  user_type_id?: number | null
  completedAt: string
  fields: Record<string, string | boolean>  // fieldId -> value
}

// LocalStorage helpers
export const STORAGE_KEYS = {
  ADMIN_PUBKEY: 'sanctum_admin_pubkey',
  ADMIN_SESSION_TOKEN: 'sanctum_admin_session_token',
  USER_EMAIL: 'sanctum_user_email',
  USER_NAME: 'sanctum_user_name',
  CUSTOM_FIELDS: 'sanctum_custom_fields',
  USER_PROFILE: 'sanctum_user_profile',
  PENDING_EMAIL: 'sanctum_pending_email',
  PENDING_NAME: 'sanctum_pending_name',
  USER_TYPE_ID: 'sanctum_user_type_id',
  SESSION_TOKEN: 'sanctum_session_token',
  USER_APPROVED: 'sanctum_user_approved',
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

// User type helpers
export function getSelectedUserTypeId(): number | null {
  const stored = localStorage.getItem(STORAGE_KEYS.USER_TYPE_ID)
  if (!stored) return null
  const parsed = parseInt(stored, 10)
  return isNaN(parsed) ? null : parsed
}

export function saveSelectedUserTypeId(typeId: number | null): void {
  if (typeId === null) {
    localStorage.removeItem(STORAGE_KEYS.USER_TYPE_ID)
  } else {
    localStorage.setItem(STORAGE_KEYS.USER_TYPE_ID, String(typeId))
  }
}

export function clearSelectedUserTypeId(): void {
  localStorage.removeItem(STORAGE_KEYS.USER_TYPE_ID)
}

// API base URL - uses Vite proxy in development, can be overridden via env var
export const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// Admin and auth response interfaces for TestDashboard
export interface AdminResponse {
  id: number
  pubkey: string
  created_at: string | null
}

export interface AdminListResponse {
  admins: AdminResponse[]
}

export interface InstanceSettingsResponse {
  settings: Record<string, string>
}

export interface RateLimitStatus {
  used: number
  limit: number
  resetAt: Date | null
}

export interface MagicLinkResponse {
  success: boolean
  message: string
}

export interface AuthUserResponse {
  id: number
  email: string
  name: string | null
  user_type_id: number | null
  approved: boolean
  created_at: string | null
  needs_onboarding?: boolean
  needs_user_type?: boolean
}

export interface VerifyTokenResponse {
  success: boolean
  user: AuthUserResponse
  session_token: string
}

export interface SessionCheckResponse {
  authenticated: boolean
  user: AuthUserResponse | null
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue: string | null
}

export interface TableInfo {
  name: string
  columns: ColumnInfo[]
  rowCount: number
}

export interface DBQueryResponse {
  success: boolean
  columns: string[]
  rows: Record<string, unknown>[]
  error?: string
  executionTimeMs?: number
}

export interface FieldDefinitionResponse {
  id: number
  field_name: string
  field_type: string
  required: boolean
  display_order: number
  user_type_id: number | null
}

export interface UserWithFieldsResponse {
  id: number
  pubkey: string | null
  email: string | null
  name: string | null
  user_type_id: number | null
  approved: boolean
  created_at: string | null
  fields: Record<string, string>
}
