import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, ChevronUp, ChevronDown, Pencil, Trash2, FilePlus, Plus, Users, Loader2, ArrowLeft, HelpCircle, X, ChevronLeft, ChevronRight, RefreshCw, UserCog, Mail, Shield, ShieldCheck, Key, Lock, User } from 'lucide-react'
import * as nip19 from 'nostr-tools/nip19'
import { OnboardingCard } from '../components/onboarding/OnboardingCard'
import { FieldEditor } from '../components/onboarding/FieldEditor'
import { IconPicker } from '../components/onboarding/IconPicker'
import { DynamicIcon } from '../components/shared/DynamicIcon'
import { CustomField, UserType, FieldType } from '../types/onboarding'
import { adminFetch, isAdminAuthenticated } from '../utils/adminApi'

const FIELD_TYPE_VALUES: FieldType[] = ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'date', 'url']
type SourceTypeFilter = 'all' | 'untyped' | number

const USER_AVATAR_COLORS = [
  { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-600 dark:text-blue-400' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-600 dark:text-emerald-400' },
  { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-600 dark:text-violet-400' },
  { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-600 dark:text-amber-400' },
  { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-600 dark:text-rose-400' },
  { bg: 'bg-cyan-100 dark:bg-cyan-900/40', text: 'text-cyan-600 dark:text-cyan-400' },
  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-600 dark:text-orange-400' },
  { bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-600 dark:text-indigo-400' },
] as const

function getUserAvatarColor(userId: number) {
  return USER_AVATAR_COLORS[userId % USER_AVATAR_COLORS.length]
}

function formatPubkeyShort(hexPubkey: string): string {
  try {
    const npub = nip19.npubEncode(hexPubkey)
    return npub.slice(0, 9) + '...' + npub.slice(-4)
  } catch {
    return hexPubkey.slice(0, 8) + '...'
  }
}

interface AdminUserSummary {
  id: number
  pubkey?: string | null
  email_encrypted?: { ciphertext: string; ephemeral_pubkey: string } | null
  name_encrypted?: { ciphertext: string; ephemeral_pubkey: string } | null
  user_type_id: number | null
  user_type?: UserType | null
  approved: boolean
  created_at?: string | null
}

interface SingleMigrationResponse {
  success: boolean
  user_id: number
  previous_user_type_id: number | null
  target_user_type_id: number
  missing_required_count: number
  missing_required_fields: string[]
}

interface BatchMigrationResult {
  user_id: number
  success: boolean
  previous_user_type_id?: number | null
  target_user_type_id?: number | null
  missing_required_count?: number
  missing_required_fields?: string[]
  error?: string
}

interface BatchMigrationResponse {
  success: boolean
  migrated: number
  failed: number
  results: BatchMigrationResult[]
}

export function AdminUserConfig() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const FIELD_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    FIELD_TYPE_VALUES.map((type) => [type, t(`admin.fieldTypes.${type}`)])
  )
  const [fields, setFields] = useState<CustomField[]>([])
  const [userTypes, setUserTypes] = useState<UserType[]>([])
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [migrationError, setMigrationError] = useState<string | null>(null)
  const [migrationSummary, setMigrationSummary] = useState<string | null>(null)
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>('all')
  const [targetMigrationTypeId, setTargetMigrationTypeId] = useState<number | null>(null)
  const [allowIncompleteMigration, setAllowIncompleteMigration] = useState(true)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())
  const [migratingUserIds, setMigratingUserIds] = useState<Set<number>>(new Set())
  const [isBatchMigrating, setIsBatchMigrating] = useState(false)
  const [recentMigrationResults, setRecentMigrationResults] = useState<BatchMigrationResult[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingField, setEditingField] = useState<CustomField | undefined>()
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDescription, setNewTypeDescription] = useState('')
  const [newTypeIcon, setNewTypeIcon] = useState('User')
  const [isAddingType, setIsAddingType] = useState(false)
  const [addTypeError, setAddTypeError] = useState<string | null>(null)
  const [isAddingTypeLoading, setIsAddingTypeLoading] = useState(false)
  const [removeTypeError, setRemoveTypeError] = useState<string | null>(null)
  const [deletingTypeIds, setDeletingTypeIds] = useState<Set<number>>(new Set())
  const [editingTypeId, setEditingTypeId] = useState<number | null>(null)
  const [editingTypeName, setEditingTypeName] = useState('')
  const [editingTypeDescription, setEditingTypeDescription] = useState('')
  const [editingTypeIcon, setEditingTypeIcon] = useState('User')
  const [editTypeError, setEditTypeError] = useState<string | null>(null)
  const [isEditingTypeLoading, setIsEditingTypeLoading] = useState(false)
  const [fieldSaving, setFieldSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)

  // Reachout settings (stored in instance_settings; only reachout_* public keys are exposed via /settings/public)
  const [reachoutLoaded, setReachoutLoaded] = useState(false)
  const [reachoutEnabled, setReachoutEnabled] = useState(false)
  const [reachoutMode, setReachoutMode] = useState<'feedback' | 'help' | 'support'>('support')
  const [reachoutToEmail, setReachoutToEmail] = useState('')
  const [reachoutSubjectPrefix, setReachoutSubjectPrefix] = useState('')
  const [reachoutRateLimitPerHour, setReachoutRateLimitPerHour] = useState('3')
  const [reachoutRateLimitPerDay, setReachoutRateLimitPerDay] = useState('10')
  const [reachoutTitle, setReachoutTitle] = useState('')
  const [reachoutDescription, setReachoutDescription] = useState('')
  const [reachoutButtonLabel, setReachoutButtonLabel] = useState('')
  const [reachoutSuccessMessage, setReachoutSuccessMessage] = useState('')
  const [reachoutSaving, setReachoutSaving] = useState(false)
  const [reachoutSaveError, setReachoutSaveError] = useState<string | null>(null)
  const [reachoutSaveSuccess, setReachoutSaveSuccess] = useState<string | null>(null)

  // User types & fields help modal state
  const [showUserHelpModal, setShowUserHelpModal] = useState(false)
  const [userHelpPage, setUserHelpPage] = useState(0)
  const userHelpModalRef = useRef<HTMLDivElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const deletingTypeIdsRef = useRef<Set<number>>(new Set())

  const optionButtonClass = (active: boolean) =>
    `w-full text-left border rounded-lg px-3 py-2 text-sm transition-all ${
      active
        ? 'border-accent bg-accent/10 text-text'
        : 'border-border bg-surface hover:border-accent/40 text-text-muted hover:text-text'
    }`

  // Check if admin is logged in
  useEffect(() => {
    if (!isAdminAuthenticated()) {
      navigate('/admin')
    }
  }, [navigate])

  // Load user types and fields from API
  useEffect(() => {
    const abortController = new AbortController()

    async function fetchData() {
      // Don't fetch if not authenticated (prevents race with navigation)
      if (!isAdminAuthenticated()) {
        setIsLoading(false)
        setLoadError(null)
        return
      }

      setLoadError(null)
      const errors: string[] = []

      try {
        const [typesRes, fieldsRes, usersRes] = await Promise.all([
          adminFetch('/admin/user-types', { signal: abortController.signal }),
          adminFetch('/admin/user-fields', { signal: abortController.signal }),
          adminFetch('/admin/users', { signal: abortController.signal }),
        ])

        if (typesRes.ok) {
          const typesData = await typesRes.json()
          setUserTypes(typesData.types || [])
        } else {
          errors.push(t('admin.errors.loadTypesFailed', 'Failed to load user types'))
        }

        if (fieldsRes.ok) {
          const fieldsData = await fieldsRes.json()
          const fetchedFields: CustomField[] = (fieldsData.fields || []).map((f: any) => ({
            id: String(f.id),
            name: f.field_name,
            type: f.field_type,
            required: f.required,
            placeholder: f.placeholder,
            options: f.options,
            user_type_id: f.user_type_id,
            encryption_enabled: f.encryption_enabled ?? true,  // Default to true for security
            include_in_chat: f.include_in_chat ?? false,  // Default to false
            display_order: f.display_order ?? 0,
          }))
          setFields(fetchedFields)
        } else {
          errors.push(t('admin.errors.loadFieldsFailed', 'Failed to load user fields'))
        }

        if (usersRes.ok) {
          const usersData = await usersRes.json()
          setUsers((usersData.users || []) as AdminUserSummary[])
          setUsersError(null)
        } else {
          const message = t('admin.errors.loadUsersFailed')
          errors.push(message)
          setUsersError(message)
        }

        // Set accumulated errors if any
        if (errors.length > 0) {
          setLoadError(errors.join('. '))
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('Error fetching admin data:', err)
        setLoadError(err instanceof Error ? err.message : t('admin.errors.loadFailed', 'Failed to load data'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
    return () => abortController.abort()
  }, [t])

  // Load reachout settings from admin-only settings endpoint
  useEffect(() => {
    let isCancelled = false

    async function fetchReachoutSettings() {
      try {
        const res = await adminFetch('/admin/settings')
        if (!res.ok) {
          if (!isCancelled) setReachoutLoaded(true)
          return
        }
        const data = await res.json()
        const s = (data?.settings ?? {}) as Record<string, string>

        if (isCancelled) return

        setReachoutEnabled(String(s.reachout_enabled ?? 'false').toLowerCase() === 'true')
        const mode = String(s.reachout_mode ?? 'support').toLowerCase()
        if (mode === 'feedback' || mode === 'help' || mode === 'support') {
          setReachoutMode(mode)
        } else {
          setReachoutMode('support')
        }
        setReachoutToEmail(String(s.reachout_to_email ?? ''))
        setReachoutSubjectPrefix(String(s.reachout_subject_prefix ?? ''))
        setReachoutRateLimitPerHour(String(s.reachout_rate_limit_per_hour ?? '3'))
        setReachoutRateLimitPerDay(String(s.reachout_rate_limit_per_day ?? '10'))
        setReachoutTitle(String(s.reachout_title ?? ''))
        setReachoutDescription(String(s.reachout_description ?? ''))
        setReachoutButtonLabel(String(s.reachout_button_label ?? ''))
        setReachoutSuccessMessage(String(s.reachout_success_message ?? ''))
        setReachoutLoaded(true)
      } catch (err) {
        console.warn('Failed to fetch reachout settings:', err)
        if (!isCancelled) setReachoutLoaded(true)
      }
    }

    if (isAdminAuthenticated()) {
      fetchReachoutSettings()
    }

    return () => {
      isCancelled = true
    }
  }, [])

  const handleSaveReachout = async () => {
    setReachoutSaveError(null)
    setReachoutSaveSuccess(null)

    if (reachoutEnabled) {
      const to = reachoutToEmail.trim()
      if (!to) {
        setReachoutSaveError(t('admin.reachout.errors.toEmailRequired', 'Destination email is required when reachout is enabled.'))
        return
      }
      const hour = Number.parseInt(reachoutRateLimitPerHour.trim(), 10)
      const day = Number.parseInt(reachoutRateLimitPerDay.trim(), 10)
      if (!Number.isFinite(hour) || hour < 1 || !Number.isFinite(day) || day < 1) {
        setReachoutSaveError(t('admin.reachout.errors.invalidRateLimits', 'Rate limits must be positive numbers.'))
        return
      }
    }

    setReachoutSaving(true)
    try {
      const res = await adminFetch('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          reachout_enabled: String(reachoutEnabled),
          reachout_mode: reachoutMode,
          reachout_to_email: reachoutToEmail.trim(),
          reachout_subject_prefix: reachoutSubjectPrefix.trim(),
          reachout_rate_limit_per_hour: reachoutRateLimitPerHour.trim(),
          reachout_rate_limit_per_day: reachoutRateLimitPerDay.trim(),
          reachout_title: reachoutTitle.trim(),
          reachout_description: reachoutDescription.trim(),
          reachout_button_label: reachoutButtonLabel.trim(),
          reachout_success_message: reachoutSuccessMessage.trim(),
        }),
      })

      if (!res.ok) {
        setReachoutSaveError(t('admin.errors.saveFailed', 'Failed to save settings. Please try again.'))
        return
      }

      setReachoutSaveSuccess(t('common.saved', 'Saved'))
      // Keep a short-lived success indicator without introducing new i18n keys.
      setTimeout(() => setReachoutSaveSuccess(null), 2000)
    } catch (err) {
      setReachoutSaveError(err instanceof Error ? err.message : t('admin.errors.saveFailed', 'Failed to save settings. Please try again.'))
    } finally {
      setReachoutSaving(false)
    }
  }

  // User Type handlers
  const handleAddUserType = async () => {
    if (!newTypeName.trim()) return

    setIsAddingTypeLoading(true)
    setAddTypeError(null)

    try {
      const nextDisplayOrder = userTypes.length > 0
        ? Math.max(...userTypes.map(ut => ut.display_order ?? 0)) + 1
        : 0
      const response = await adminFetch('/admin/user-types', {
        method: 'POST',
        body: JSON.stringify({
          name: newTypeName.trim(),
          description: newTypeDescription.trim() || null,
          icon: newTypeIcon,
          display_order: nextDisplayOrder,
        }),
      })

      if (response.ok) {
        const newType = await response.json()
        setUserTypes([...userTypes, newType])
        setNewTypeName('')
        setNewTypeDescription('')
        setNewTypeIcon('User')
        setIsAddingType(false)
      } else {
        setAddTypeError(t('admin.errors.addTypeFailed', 'Failed to add user type'))
      }
    } catch (err) {
      console.error('Error adding user type:', err)
      setAddTypeError(err instanceof Error ? err.message : t('admin.errors.addTypeFailed', 'Failed to add user type'))
    } finally {
      setIsAddingTypeLoading(false)
    }
  }

  const handleStartEditUserType = (userType: UserType) => {
    setEditingTypeId(userType.id)
    setEditingTypeName(userType.name)
    setEditingTypeDescription(userType.description || '')
    setEditingTypeIcon(userType.icon || 'User')
    setEditTypeError(null)
    setIsAddingType(false)
  }

  const handleCancelEditUserType = () => {
    setEditingTypeId(null)
    setEditingTypeName('')
    setEditingTypeDescription('')
    setEditingTypeIcon('User')
    setEditTypeError(null)
  }

  const handleUpdateUserType = async () => {
    if (!editingTypeId || !editingTypeName.trim()) return

    setIsEditingTypeLoading(true)
    setEditTypeError(null)

    try {
      const response = await adminFetch(`/admin/user-types/${editingTypeId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editingTypeName.trim(),
          description: editingTypeDescription.trim() || null,
          icon: editingTypeIcon,
        }),
      })

      if (response.ok) {
        const updatedType = await response.json()
        setUserTypes(userTypes.map((type) => (
          type.id === editingTypeId ? updatedType : type
        )))
        handleCancelEditUserType()
      } else {
        setEditTypeError(t('admin.errors.updateTypeFailed', 'Failed to update user type'))
      }
    } catch (err) {
      console.error('Error updating user type:', err)
      setEditTypeError(err instanceof Error ? err.message : t('admin.errors.updateTypeFailed', 'Failed to update user type'))
    } finally {
      setIsEditingTypeLoading(false)
    }
  }

  const handleRemoveUserType = async (typeId: number) => {
    if (deletingTypeIdsRef.current.has(typeId)) return

    // Count fields that will be deleted
    const fieldCount = fields.filter((f) => f.user_type_id === typeId).length
    const userType = userTypes.find((ut) => ut.id === typeId)
    const typeName = userType?.name || t('common.unknown', 'Unknown')

    // Show confirmation dialog
    const message = fieldCount > 0
      ? t('admin.confirmDeleteTypeWithFields', {
          name: typeName,
          count: fieldCount,
          defaultValue: `Delete user type "${typeName}"? This will also delete ${fieldCount} associated field(s).`
        })
      : t('admin.confirmDeleteType', {
          name: typeName,
          defaultValue: `Delete user type "${typeName}"?`
        })

    if (!window.confirm(message)) {
      return
    }

    setRemoveTypeError(null)
    deletingTypeIdsRef.current.add(typeId)
    setDeletingTypeIds((prev) => {
      const next = new Set(prev)
      next.add(typeId)
      return next
    })

    try {
      const response = await adminFetch(`/admin/user-types/${typeId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setUserTypes((prev) => prev.filter((ut) => ut.id !== typeId))
        // Remove fields associated with this type from local state
        setFields((prev) => prev.filter((f) => f.user_type_id !== typeId))
      } else {
        setRemoveTypeError(t('admin.errors.removeTypeFailed', 'Failed to remove user type'))
      }
    } catch (err) {
      console.error('Error removing user type:', err)
      setRemoveTypeError(err instanceof Error ? err.message : t('admin.errors.removeTypeFailed', 'Failed to remove user type'))
    } finally {
      deletingTypeIdsRef.current.delete(typeId)
      setDeletingTypeIds((prev) => {
        if (!prev.has(typeId)) return prev
        const next = new Set(prev)
        next.delete(typeId)
        return next
      })
    }
  }

  const handleAddField = async (field: CustomField) => {
    setFieldSaving(true)
    setFieldError(null)

    try {
      const nextFieldDisplayOrder = fields.length > 0
        ? Math.max(...fields.map(f => f.display_order ?? 0)) + 1
        : 0
      const response = await adminFetch('/admin/user-fields', {
        method: 'POST',
        body: JSON.stringify({
          field_name: field.name,
          field_type: field.type,
          required: field.required,
          display_order: nextFieldDisplayOrder,
          user_type_id: field.user_type_id,
          placeholder: field.placeholder || null,
          options: field.options || null,
          encryption_enabled: field.encryption_enabled ?? true,  // Secure default
          include_in_chat: field.include_in_chat ?? false,
        }),
      })

      if (response.ok) {
        const newField = await response.json()
        const addedField: CustomField = {
          id: String(newField.id),
          name: newField.field_name,
          type: newField.field_type,
          required: newField.required,
          placeholder: newField.placeholder,
          options: newField.options,
          user_type_id: newField.user_type_id,
          encryption_enabled: newField.encryption_enabled ?? true,
          include_in_chat: newField.include_in_chat ?? false,
          display_order: newField.display_order ?? 0,
        }
        setFields([...fields, addedField])
        setIsEditing(false)
        setEditingField(undefined)
      } else {
        console.error('Failed to add field:', response.status)
        setFieldError(t('admin.errors.addFieldFailed', 'Failed to add field'))
        // Keep editor open for retry
      }
    } catch (err) {
      console.error('Error adding field:', err)
      setFieldError(err instanceof Error ? err.message : t('admin.errors.addFieldFailed', 'Failed to add field'))
      // Keep editor open for retry
    } finally {
      setFieldSaving(false)
    }
  }

  const handleUpdateField = async (field: CustomField) => {
    setFieldSaving(true)
    setFieldError(null)

    try {
      const response = await adminFetch(`/admin/user-fields/${field.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          field_name: field.name,
          field_type: field.type,
          required: field.required,
          user_type_id: field.user_type_id,
          placeholder: field.placeholder || null,
          options: field.options || null,
          encryption_enabled: field.encryption_enabled ?? true,  // Secure default
          include_in_chat: field.include_in_chat ?? false,
        }),
      })

      if (response.ok) {
        const updatedField = await response.json()
        const normalizedField: CustomField = {
          id: String(updatedField.id),
          name: updatedField.field_name,
          type: updatedField.field_type,
          required: updatedField.required,
          placeholder: updatedField.placeholder,
          options: updatedField.options,
          user_type_id: updatedField.user_type_id,
          encryption_enabled: updatedField.encryption_enabled ?? true,
          include_in_chat: updatedField.include_in_chat ?? false,
          display_order: updatedField.display_order ?? 0,
        }
        setFields(fields.map((f) => (f.id === field.id ? normalizedField : f)))
        setIsEditing(false)
        setEditingField(undefined)
      } else {
        console.error('Failed to update field:', response.status)
        setFieldError(t('admin.errors.updateFieldFailed', 'Failed to update field'))
        // Keep editor open for retry
      }
    } catch (err) {
      console.error('Error updating field:', err)
      setFieldError(err instanceof Error ? err.message : t('admin.errors.updateFieldFailed', 'Failed to update field'))
      // Keep editor open for retry
    } finally {
      setFieldSaving(false)
    }
  }

  const handleRemoveField = async (id: string) => {
    const field = fields.find((f) => f.id === id)
    const fieldName = field?.name || t('common.unknown', 'Unknown')

    if (!window.confirm(t('admin.confirmDeleteField', {
      name: fieldName,
      defaultValue: `Delete field "${fieldName}"?`
    }))) {
      return
    }

    setFieldError(null)  // Clear any previous error

    try {
      const response = await adminFetch(`/admin/user-fields/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setFields(fields.filter((f) => f.id !== id))
      } else {
        setFieldError(t('admin.errors.removeFieldFailed', 'Failed to remove field'))
      }
    } catch (err) {
      console.error('Error removing field:', err)
      setFieldError(err instanceof Error ? err.message : t('admin.errors.removeFieldFailed', 'Failed to remove field'))
    }
  }

  const handleMoveField = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= fields.length) return

    setIsReordering(true)
    setReorderError(null)

    // Save previous state for rollback
    const previousFields = [...fields]

    // Compute new fields order
    const newFields = [...fields]
    const temp = newFields[index]
    newFields[index] = newFields[newIndex]
    newFields[newIndex] = temp

    // Persist display_order changes to backend sequentially to handle partial failures
    try {
      // First update
      const firstResponse = await adminFetch(`/admin/user-fields/${newFields[index].id}`, {
        method: 'PUT',
        body: JSON.stringify({ display_order: index }),
      })

      if (!firstResponse.ok) {
        setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
        // No backend change happened, just keep previous UI state
        return
      }

      // Second update
      const secondResponse = await adminFetch(`/admin/user-fields/${newFields[newIndex].id}`, {
        method: 'PUT',
        body: JSON.stringify({ display_order: newIndex }),
      })

      if (!secondResponse.ok) {
        // First succeeded, second failed - try to revert the first one
        try {
          await adminFetch(`/admin/user-fields/${newFields[index].id}`, {
            method: 'PUT',
            body: JSON.stringify({ display_order: newIndex }), // Restore original order
          })
        } catch (revertErr) {
          // Revert failed - refetch fields to sync state
          const fieldsRes = await adminFetch('/admin/user-fields')
          if (fieldsRes.ok) {
            const fieldsData = await fieldsRes.json()
            const fetchedFields: CustomField[] = (fieldsData.fields || []).map((f: any) => ({
              id: String(f.id),
              name: f.field_name,
              type: f.field_type,
              required: f.required,
              placeholder: f.placeholder,
              options: f.options,
              user_type_id: f.user_type_id,
              encryption_enabled: f.encryption_enabled ?? true,  // Default to true for security
              include_in_chat: f.include_in_chat ?? false,
              display_order: f.display_order ?? 0,
            }))
            setFields(fetchedFields)
            setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
            return
          }
        }
        // Keep previous UI state since we reverted (or tried to)
        setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
        return
      }

      // Both succeeded - update UI
      setFields(newFields)
    } catch (err) {
      // Network error - keep previous state (no backend change happened or partial)
      // Refetch to ensure UI is in sync
      try {
        const fieldsRes = await adminFetch('/admin/user-fields')
        if (fieldsRes.ok) {
          const fieldsData = await fieldsRes.json()
          const fetchedFields: CustomField[] = (fieldsData.fields || []).map((f: any) => ({
            id: String(f.id),
            name: f.field_name,
            type: f.field_type,
            required: f.required,
            placeholder: f.placeholder,
            options: f.options,
            user_type_id: f.user_type_id,
            encryption_enabled: f.encryption_enabled ?? true,  // Default to true for security
            include_in_chat: f.include_in_chat ?? false,
            display_order: f.display_order ?? 0,
          }))
          setFields(fetchedFields)
        }
      } catch {
        // If refetch also fails, keep previous state
        setFields(previousFields)
      }
      setReorderError(t('admin.errors.reorderFailed', 'Failed to reorder field'))
    } finally {
      setIsReordering(false)
    }
  }

  const handleEditField = (field: CustomField) => {
    setEditingField(field)
    setIsEditing(true)
    setFieldError(null)
  }

  const parseErrorMessage = async (response: Response, fallback: string): Promise<string> => {
    try {
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const payload = await response.json()
        if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail
        if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message
      } else {
        const text = await response.text()
        if (text.trim()) return text
      }
    } catch {
      // Fall back to provided string below.
    }
    return fallback
  }

  const fetchUsers = async () => {
    setUsersLoading(true)
    setUsersError(null)

    try {
      const response = await adminFetch('/admin/users')
      if (!response.ok) {
        setUsersError(await parseErrorMessage(response, t('admin.errors.loadUsersFailed')))
        return
      }
      const data = await response.json()
      setUsers((data.users || []) as AdminUserSummary[])
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : t('admin.errors.loadUsersFailed'))
    } finally {
      setUsersLoading(false)
    }
  }

  const handleToggleUserSelection = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const handleToggleSelectAllFilteredUsers = () => {
    if (filteredUsers.length === 0) return

    const allSelected = filteredUsers.every((user) => selectedUserIds.has(user.id))
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        filteredUsers.forEach((user) => next.delete(user.id))
      } else {
        filteredUsers.forEach((user) => next.add(user.id))
      }
      return next
    })
  }

  const handleMigrateSingleUser = async (userId: number) => {
    if (!targetMigrationTypeId) {
      setMigrationError(t('admin.userMigration.targetRequired'))
      return
    }

    setMigrationError(null)
    setMigrationSummary(null)
    setMigratingUserIds((prev) => {
      const next = new Set(prev)
      next.add(userId)
      return next
    })

    try {
      const response = await adminFetch(`/admin/users/${userId}/migrate-type`, {
        method: 'POST',
        body: JSON.stringify({
          target_user_type_id: targetMigrationTypeId,
          allow_incomplete: allowIncompleteMigration,
        }),
      })

      if (!response.ok) {
        setMigrationError(await parseErrorMessage(response, t('admin.userMigration.singleFailed')))
        return
      }

      const result = await response.json() as SingleMigrationResponse
      setRecentMigrationResults((prev) => [
        {
          user_id: result.user_id,
          success: result.success,
          previous_user_type_id: result.previous_user_type_id,
          target_user_type_id: result.target_user_type_id,
          missing_required_count: result.missing_required_count,
          missing_required_fields: result.missing_required_fields,
        },
        ...prev.filter((item) => item.user_id !== result.user_id),
      ].slice(0, 20))

      setMigrationSummary(
        t('admin.userMigration.singleSummary', {
          userId: result.user_id,
          count: result.missing_required_count,
        })
      )

      await fetchUsers()
    } catch (err) {
      setMigrationError(err instanceof Error ? err.message : t('admin.userMigration.singleFailed'))
    } finally {
      setMigratingUserIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const handleMigrateSelectedUsers = async () => {
    if (!targetMigrationTypeId) {
      setMigrationError(t('admin.userMigration.targetRequired'))
      return
    }

    const userIds = [...selectedUserIds]
    if (userIds.length === 0) {
      setMigrationError(t('admin.userMigration.selectUsers'))
      return
    }

    setMigrationError(null)
    setMigrationSummary(null)
    setIsBatchMigrating(true)

    try {
      const response = await adminFetch('/admin/users/migrate-type/batch', {
        method: 'POST',
        body: JSON.stringify({
          user_ids: userIds,
          target_user_type_id: targetMigrationTypeId,
          allow_incomplete: allowIncompleteMigration,
        }),
      })

      if (!response.ok) {
        setMigrationError(await parseErrorMessage(response, t('admin.userMigration.batchFailed')))
        return
      }

      const result = await response.json() as BatchMigrationResponse
      const latestResults = result.results || []
      setRecentMigrationResults((prev) => [...latestResults, ...prev].slice(0, 20))

      const failedIds = latestResults.filter((entry) => !entry.success).map((entry) => entry.user_id)
      setSelectedUserIds(new Set(failedIds))

      setMigrationSummary(
        t('admin.userMigration.batchSummary', {
          migrated: result.migrated,
          failed: result.failed,
        })
      )

      await fetchUsers()
    } catch (err) {
      setMigrationError(err instanceof Error ? err.message : t('admin.userMigration.batchFailed'))
    } finally {
      setIsBatchMigrating(false)
    }
  }

  useEffect(() => {
    if (userTypes.length === 0) {
      setTargetMigrationTypeId(null)
      return
    }

    const targetExists = targetMigrationTypeId !== null && userTypes.some((type) => type.id === targetMigrationTypeId)
    if (!targetExists) {
      setTargetMigrationTypeId(userTypes[0].id)
    }
  }, [userTypes, targetMigrationTypeId])

  useEffect(() => {
    setSelectedUserIds((prev) => {
      const userIds = new Set(users.map((user) => user.id))
      const next = new Set<number>()
      prev.forEach((id) => {
        if (userIds.has(id)) next.add(id)
      })
      return next
    })
  }, [users])

  // Close user help modal
  const handleCloseUserHelpModal = () => {
    setShowUserHelpModal(false)
    setUserHelpPage(0)
    // Return focus to the help button that triggered the modal
    helpButtonRef.current?.focus()
  }

  // Focus trap for user help modal
  useEffect(() => {
    if (showUserHelpModal && userHelpModalRef.current) {
      userHelpModalRef.current.focus()
    }
  }, [showUserHelpModal])

  // Handle keyboard navigation within the modal (focus trap)
  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCloseUserHelpModal()
      return
    }

    if (e.key === 'Tab') {
      const modal = userHelpModalRef.current
      if (!modal) return

      // Get all focusable elements within the modal
      const focusableElements = modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )

      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, move to last
        if (document.activeElement === firstElement || document.activeElement === modal) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab: if focus is on last element, move to first
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }
  }

  // User types & fields help pages data
  const USER_HELP_PAGES = [
    {
      title: t('admin.userHelp.overviewTitle', 'User Types & Fields Overview'),
      content: 'overview',
    },
    {
      title: t('admin.userHelp.typesTitle', 'Understanding User Types'),
      content: 'types',
    },
    {
      title: t('admin.userHelp.fieldsTitle', 'Field Types Explained'),
      content: 'fields',
    },
    {
      title: t('admin.userHelp.tipsTitle', 'Tips & Best Practices'),
      content: 'tips',
    },
  ]

  // Helper to get user type name by id
  const getUserTypeName = (typeId: number | null | undefined): string => {
    if (typeId === null || typeId === undefined) return t('admin.global')
    const userType = userTypes.find((ut) => ut.id === typeId)
    return userType?.name || t('common.unknown', 'Unknown')
  }

  const filteredUsers = useMemo(() => {
    if (sourceTypeFilter === 'all') return users
    if (sourceTypeFilter === 'untyped') {
      return users.filter((user) => user.user_type_id === null || user.user_type_id === undefined)
    }
    return users.filter((user) => user.user_type_id === sourceTypeFilter)
  }, [users, sourceTypeFilter])

  const selectedVisibleCount = useMemo(
    () => filteredUsers.filter((user) => selectedUserIds.has(user.id)).length,
    [filteredUsers, selectedUserIds]
  )

  const allFilteredSelected = useMemo(
    () => filteredUsers.length > 0 && filteredUsers.every((user) => selectedUserIds.has(user.id)),
    [filteredUsers, selectedUserIds]
  )

  const latestResultByUser = useMemo(() => {
    const byUser: Record<number, BatchMigrationResult> = {}
    for (const result of recentMigrationResults) {
      if (byUser[result.user_id] === undefined) {
        byUser[result.user_id] = result
      }
    }
    return byUser
  }, [recentMigrationResults])

  const footer = (
    <Link to="/admin/setup" className="text-text-muted hover:text-text transition-colors">
      {t('common.back', 'Back to Dashboard')}
    </Link>
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  return (
    <OnboardingCard
      size="xl"
      title={t('admin.userConfig.title', 'User Configuration')}
      subtitle={t('admin.userConfig.subtitle', 'Configure user types and the questions users answer during onboarding.')}
      footer={footer}
    >
      {isEditing ? (
        <div className="space-y-4">
          {fieldError && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3">
              <p className="text-xs text-error">{fieldError}</p>
            </div>
          )}
          {fieldSaving && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('common.saving', 'Saving...')}
            </div>
          )}
          <FieldEditor
            onSave={editingField ? handleUpdateField : handleAddField}
            onCancel={() => {
              setIsEditing(false)
              setEditingField(undefined)
              setFieldError(null)
            }}
            initialField={editingField}
            userTypes={userTypes}
          />
        </div>
      ) : (
        <div className="space-y-6 stagger-children">
          {/* Load Error display */}
          {loadError && (
            <div className="bg-error/10 border border-error/20 rounded-xl p-4">
              <p className="text-sm text-error">{loadError}</p>
            </div>
          )}

          {/* User Types Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-text-muted" />
              {t('admin.setup.userTypes')}
              <button
                ref={helpButtonRef}
                onClick={() => setShowUserHelpModal(true)}
                className="ml-1 text-text-muted hover:text-accent transition-colors"
                aria-label={t('admin.userHelp.ariaLabel', 'User types and fields help')}
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            </h3>
            <p className="text-xs text-text-muted mb-4">
              {t('admin.setup.userTypesHint')}
            </p>

            {/* Remove type error display */}
            {removeTypeError && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-4">
                <p className="text-xs text-error">{removeTypeError}</p>
              </div>
            )}

            {/* Types List */}
            {userTypes.length > 0 && (
              <div className="space-y-2 mb-4">
                {userTypes.map((userType) => (
                  // Disable delete controls per type while request is in flight.
                  editingTypeId === userType.id ? (
                    <div
                      key={userType.id}
                      className="bg-surface border border-border rounded-xl p-4 space-y-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                          <DynamicIcon name={editingTypeIcon} size={16} className="text-accent" />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-medium text-text mb-1 block">{t('admin.userConfig.typeName', 'Type Name')}</label>
                          <input
                            type="text"
                            value={editingTypeName}
                            onChange={(e) => setEditingTypeName(e.target.value)}
                            placeholder={t('admin.setup.typeNamePlaceholder')}
                            className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text mb-1 block">{t('admin.userConfig.typeDescription', 'Description')}</label>
                        <input
                          type="text"
                          value={editingTypeDescription}
                          onChange={(e) => setEditingTypeDescription(e.target.value)}
                          placeholder={t('admin.setup.typeDescPlaceholder')}
                          className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text mb-2 block">{t('admin.userConfig.typeIcon', 'Type Icon')}</label>
                        <IconPicker value={editingTypeIcon} onChange={setEditingTypeIcon} />
                      </div>
                      {editTypeError && (
                        <p className="text-xs text-error">{editTypeError}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCancelEditUserType}
                          className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface transition-all"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          onClick={handleUpdateUserType}
                          disabled={!editingTypeName.trim() || isEditingTypeLoading}
                          className="flex-1 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {isEditingTypeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                          {t('common.save', 'Save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={userType.id}
                      className="bg-surface border border-border rounded-xl p-3.5 flex items-center justify-between hover:border-border-strong hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-surface-overlay flex items-center justify-center">
                          <DynamicIcon name={userType.icon || 'Users'} size={16} className="text-text-muted" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text">{userType.name}</p>
                          {userType.description && (
                            <p className="text-xs text-text-muted">{userType.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleStartEditUserType(userType)}
                          className="p-1 text-text-muted hover:text-accent transition-colors"
                          title={t('common.edit')}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRemoveUserType(userType.id)}
                          disabled={deletingTypeIds.has(userType.id)}
                          className={`p-1 transition-colors ${
                            deletingTypeIds.has(userType.id)
                              ? 'text-text-muted/50 cursor-not-allowed'
                              : 'text-text-muted hover:text-error'
                          }`}
                          title={t('common.remove')}
                          aria-busy={deletingTypeIds.has(userType.id)}
                        >
                          {deletingTypeIds.has(userType.id) ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}

            {/* Add Type Form */}
            {isAddingType ? (
              <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-text mb-1 block">{t('admin.setup.typeName')}</label>
                  <input
                    type="text"
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    placeholder={t('admin.setup.typeNamePlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text mb-1 block">{t('admin.setup.typeDescription')}</label>
                  <input
                    type="text"
                    value={newTypeDescription}
                    onChange={(e) => setNewTypeDescription(e.target.value)}
                    placeholder={t('admin.setup.typeDescPlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text mb-2 block">{t('admin.userConfig.typeIcon', 'Type Icon')}</label>
                  <IconPicker value={newTypeIcon} onChange={setNewTypeIcon} />
                </div>
                {addTypeError && (
                  <p className="text-xs text-error">{addTypeError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setIsAddingType(false)
                      setNewTypeName('')
                      setNewTypeDescription('')
                      setNewTypeIcon('User')
                      setAddTypeError(null)
                    }}
                    className="flex-1 bg-surface-overlay border border-border text-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleAddUserType}
                    disabled={!newTypeName.trim() || isAddingTypeLoading}
                    className="flex-1 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isAddingTypeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('admin.setup.addType')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingType(true)}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2 text-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                {t('admin.setup.addUserType')}
              </button>
            )}
          </div>

          {/* User Fields Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-text-muted" />
              {t('admin.setup.onboardingFields')}
            </h3>
            <p className="text-xs text-text-muted mb-4">
              {t('admin.setup.onboardingFieldsHint', 'Create the questions users answer during onboarding.')}
            </p>

            {/* Field error display for deletion failures */}
            {fieldError && !isEditing && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-error">{fieldError}</p>
              </div>
            )}

            {/* Reorder error display */}
            {reorderError && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-error">{reorderError}</p>
              </div>
            )}

            {/* Fields List */}
            {fields.length > 0 ? (
              <div className="space-y-2 mb-4">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="bg-surface border border-border rounded-xl p-3.5 animate-fade-in hover:border-border-strong hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Field name and required tag */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-text">{field.name}</p>
                          {field.required && (
                            <span className="inline-flex items-center text-[10px] font-medium bg-accent/15 text-accent px-2 py-0.5 rounded-md border border-accent/30">
                              {t('common.required')}
                            </span>
                          )}
                        </div>

                        {/* Type information */}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs text-text-muted">
                            {FIELD_TYPE_LABELS[field.type] || field.type}
                          </span>
                          {field.type === 'select' && field.options && (
                            <span className="text-xs text-text-muted">
                              • {t('admin.setup.optionsCount', { count: field.options.length })}
                            </span>
                          )}
                        </div>

                        {/* Tags container */}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-md border ${
                            field.encryption_enabled !== false
                              ? 'bg-accent/10 text-accent border-accent/20'
                              : 'bg-warning/10 text-warning border-warning/20'
                          }`}>
                            {field.encryption_enabled !== false ? `🔒 ${t('admin.fields.encryptedBadge')}` : `🔓 ${t('admin.fields.plaintextBadge')}`}
                          </span>
                          {field.include_in_chat && field.encryption_enabled === false && (
                            <span className="inline-flex items-center text-[10px] font-medium bg-accent/10 text-accent px-2 py-0.5 rounded-md border border-accent/20">
                              💬 {t('admin.fields.inChatBadge')}
                            </span>
                          )}
                          <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-md border bg-surface-overlay/50 text-text border-border">
                            {getUserTypeName(field.user_type_id)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5">
                        {/* Move Up */}
                        <button
                          onClick={() => handleMoveField(index, 'up')}
                          disabled={isReordering || index === 0}
                          className="p-1 text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={t('common.moveUp')}
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        {/* Move Down */}
                        <button
                          onClick={() => handleMoveField(index, 'down')}
                          disabled={isReordering || index === fields.length - 1}
                          className="p-1 text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={t('common.moveDown')}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => handleEditField(field)}
                          className="p-1 text-text-muted hover:text-accent transition-colors"
                          title={t('common.edit')}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {/* Remove */}
                        <button
                          onClick={() => handleRemoveField(field.id)}
                          className="p-1 text-text-muted hover:text-error transition-colors"
                          title={t('common.remove')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 bg-surface border border-border border-dashed rounded-lg mb-4">
                <FilePlus className="w-8 h-8 text-text-muted mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-xs text-text-muted">{t('admin.setup.noFields')}</p>
              </div>
            )}

            {/* Add Field Button */}
            <button
              onClick={() => { setFieldError(null); setIsEditing(true) }}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent text-text-muted hover:text-accent rounded-lg px-3 py-2 text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              {t('admin.setup.addField')}
            </button>
          </div>

          {/* Reachout Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-2 flex items-center gap-2">
              <Mail className="w-4 h-4 text-text-muted" />
              {t('admin.reachout.title', 'User Reachout')}
            </h3>
            <p className="text-xs text-text-muted mb-4">
              {t('admin.reachout.subtitle', 'Optionally let authenticated users send a message to your team via email.')}
            </p>

            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={reachoutEnabled}
                  onChange={(e) => { setReachoutEnabled(e.target.checked) }}
                  className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                />
                {t('admin.reachout.enableLabel', 'Enable reachout button in chat')}
                {!reachoutLoaded && (
                  <span className="text-xs text-text-muted">
                    {t('admin.reachout.loadingHint', 'Loading...')}
                  </span>
                )}
              </label>

              <div>
                <span className="text-sm font-medium text-text mb-2 block">
                  {t('admin.reachout.modeLabel', 'Framing')}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(['feedback', 'help', 'support'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setReachoutMode(mode)}
                      className={optionButtonClass(reachoutMode === mode)}
                      aria-pressed={reachoutMode === mode}
                    >
                      <p className="text-sm font-medium text-text">
                        {t(`admin.reachout.mode.${mode}.title`, mode === 'feedback' ? 'Feedback' : mode === 'help' ? 'Help' : 'Support')}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {t(
                          `admin.reachout.mode.${mode}.desc`,
                          mode === 'feedback'
                            ? 'Invite product feedback and suggestions.'
                            : mode === 'help'
                              ? 'Offer help with using the instance.'
                              : 'Offer support for issues and requests.'
                        )}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reachout-to-email" className="text-sm font-medium text-text mb-1.5 block">
                    {t('admin.reachout.toEmailLabel', 'Destination Email')}
                  </label>
                  <input
                    id="reachout-to-email"
                    type="email"
                    value={reachoutToEmail}
                    onChange={(e) => setReachoutToEmail(e.target.value)}
                    placeholder={t('admin.reachout.toEmailPlaceholder', 'support@example.com')}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <p className="text-xs text-text-muted mt-1.5">
                    {t('admin.reachout.toEmailHint', 'Emails will be sent using your configured SMTP settings.')}
                  </p>
                </div>

                <div>
                  <label htmlFor="reachout-subject-prefix" className="text-sm font-medium text-text mb-1.5 block">
                    {t('admin.reachout.subjectPrefixLabel', 'Subject Prefix')}
                  </label>
                  <input
                    id="reachout-subject-prefix"
                    type="text"
                    value={reachoutSubjectPrefix}
                    onChange={(e) => setReachoutSubjectPrefix(e.target.value)}
                    placeholder={t('admin.reachout.subjectPrefixPlaceholder', '[Support]')}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <p className="text-xs text-text-muted mt-1.5">
                    {t('admin.reachout.subjectPrefixHint', 'Optional. Prepended to the email subject line.')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reachout-limit-hour" className="text-sm font-medium text-text mb-1.5 block">
                    {t('admin.reachout.limitHourLabel', 'Rate Limit (per hour)')}
                  </label>
                  <input
                    id="reachout-limit-hour"
                    type="number"
                    min={1}
                    value={reachoutRateLimitPerHour}
                    onChange={(e) => setReachoutRateLimitPerHour(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                <div>
                  <label htmlFor="reachout-limit-day" className="text-sm font-medium text-text mb-1.5 block">
                    {t('admin.reachout.limitDayLabel', 'Rate Limit (per day)')}
                  </label>
                  <input
                    id="reachout-limit-day"
                    type="number"
                    min={1}
                    value={reachoutRateLimitPerDay}
                    onChange={(e) => setReachoutRateLimitPerDay(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>

              <div className="border-t border-border/60 pt-4">
                <p className="text-xs text-text-muted mb-3">
                  {t('admin.reachout.copyHint', 'Optional copy overrides. If blank, the UI uses translated defaults based on the selected framing. Overrides apply to all languages.')}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reachout-title" className="text-sm font-medium text-text mb-1.5 block">
                      {t('admin.reachout.overrideTitleLabel', 'Title Override')}
                    </label>
                    <input
                      id="reachout-title"
                      type="text"
                      value={reachoutTitle}
                      onChange={(e) => setReachoutTitle(e.target.value)}
                      placeholder={t('admin.reachout.overrideTitlePlaceholder', 'Contact support')}
                      className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="reachout-button-label" className="text-sm font-medium text-text mb-1.5 block">
                      {t('admin.reachout.overrideButtonLabel', 'Button Label Override')}
                    </label>
                    <input
                      id="reachout-button-label"
                      type="text"
                      value={reachoutButtonLabel}
                      onChange={(e) => setReachoutButtonLabel(e.target.value)}
                      placeholder={t('admin.reachout.overrideButtonPlaceholder', 'Send message')}
                      className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label htmlFor="reachout-description" className="text-sm font-medium text-text mb-1.5 block">
                      {t('admin.reachout.overrideDescriptionLabel', 'Description Override')}
                    </label>
                    <input
                      id="reachout-description"
                      type="text"
                      value={reachoutDescription}
                      onChange={(e) => setReachoutDescription(e.target.value)}
                      placeholder={t('admin.reachout.overrideDescriptionPlaceholder', 'Tell us what you need and we will reply by email.')}
                      className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="reachout-success" className="text-sm font-medium text-text mb-1.5 block">
                      {t('admin.reachout.overrideSuccessLabel', 'Success Message Override')}
                    </label>
                    <input
                      id="reachout-success"
                      type="text"
                      value={reachoutSuccessMessage}
                      onChange={(e) => setReachoutSuccessMessage(e.target.value)}
                      placeholder={t('admin.reachout.overrideSuccessPlaceholder', 'Thanks. Your message was sent.')}
                      className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>
              </div>

              {reachoutSaveError && (
                <div className="bg-error/10 border border-error/20 rounded-lg p-3">
                  <p className="text-xs text-error">{reachoutSaveError}</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                {reachoutSaveSuccess && (
                  <p className="text-xs text-accent">{reachoutSaveSuccess}</p>
                )}
                <button
                  type="button"
                  onClick={handleSaveReachout}
                  disabled={reachoutSaving}
                  className="inline-flex items-center gap-2 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reachoutSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {reachoutSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                </button>
              </div>
            </div>
          </div>

          {/* User Migration Section */}
          <div className="card card-sm p-5! bg-surface-overlay!">
            <h3 className="heading-sm mb-4 flex items-center gap-2">
              <UserCog className="w-4 h-4 text-text-muted" />
              {t('admin.userMigration.title')}
            </h3>
            <p className="text-xs text-text-muted mb-2">
              {t('admin.userMigration.subtitle')}
            </p>
            <p className="text-[11px] text-text-muted mb-4">
              {t(
                'admin.userMigration.anonymizedHint',
                'Users are shown anonymously here. Names/emails are encrypted and intentionally hidden in this list.'
              )}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium text-text mb-1 block">
                  {t('admin.userMigration.sourceFilter')}
                </label>
                <select
                  value={typeof sourceTypeFilter === 'number' ? String(sourceTypeFilter) : sourceTypeFilter}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === 'all' || value === 'untyped') {
                      setSourceTypeFilter(value)
                      return
                    }
                    const parsed = Number(value)
                    setSourceTypeFilter(Number.isNaN(parsed) ? 'all' : parsed)
                  }}
                  className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  <option value="all">{t('admin.userMigration.filterAll')}</option>
                  <option value="untyped">{t('admin.userMigration.filterUntyped')}</option>
                  {userTypes.map((type) => (
                    <option key={type.id} value={String(type.id)}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-text mb-1 block">
                  {t('admin.userMigration.targetType')}
                </label>
                <select
                  value={targetMigrationTypeId ?? ''}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === '') {
                      setTargetMigrationTypeId(null)
                      return
                    }
                    const parsed = Number(value)
                    setTargetMigrationTypeId(Number.isNaN(parsed) ? null : parsed)
                  }}
                  disabled={userTypes.length === 0}
                  className="w-full border border-border rounded-lg px-3 py-2 bg-surface text-text text-sm disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                >
                  {userTypes.length === 0 ? (
                    <option value="">{t('admin.userMigration.noTypes')}</option>
                  ) : (
                    userTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <label className="flex items-center gap-2 mt-6 md:mt-0 md:self-end text-sm text-text">
                <input
                  type="checkbox"
                  checked={allowIncompleteMigration}
                  onChange={(e) => setAllowIncompleteMigration(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent/30"
                />
                {t('admin.userMigration.allowIncomplete')}
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                onClick={fetchUsers}
                disabled={usersLoading || isBatchMigrating}
                className="inline-flex items-center gap-2 border border-border text-text rounded-lg px-3 py-2 text-sm hover:bg-surface transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${usersLoading ? 'animate-spin' : ''}`} />
                {t('common.refresh', 'Refresh')}
              </button>

              <button
                onClick={handleToggleSelectAllFilteredUsers}
                disabled={filteredUsers.length === 0 || isBatchMigrating}
                className="inline-flex items-center gap-2 border border-border text-text rounded-lg px-3 py-2 text-sm hover:bg-surface transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {allFilteredSelected
                  ? t('admin.userMigration.clearVisible')
                  : t('admin.userMigration.selectVisible')}
              </button>

              <button
                onClick={handleMigrateSelectedUsers}
                disabled={isBatchMigrating || selectedUserIds.size === 0 || !targetMigrationTypeId}
                className="inline-flex items-center gap-2 bg-accent text-accent-text rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBatchMigrating && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('admin.userMigration.migrateSelected', {
                  count: selectedUserIds.size,
                })}
              </button>
            </div>

            <p className="text-xs text-text-muted mb-3">
              {t('admin.userMigration.visibleSelected', {
                selected: selectedVisibleCount,
                visible: filteredUsers.length,
              })}
            </p>

            {usersError && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-error">{usersError}</p>
              </div>
            )}

            {migrationError && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-error">{migrationError}</p>
              </div>
            )}

            {migrationSummary && (
              <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-accent">{migrationSummary}</p>
              </div>
            )}

            {usersLoading ? (
              <div className="py-6 flex items-center justify-center text-text-muted text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                {t('admin.userMigration.loadingUsers')}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8 bg-surface border border-border border-dashed rounded-lg">
                <Users className="w-6 h-6 text-text-muted mx-auto mb-2" />
                <p className="text-xs text-text-muted">{t('admin.userMigration.noUsers')}</p>
                <p className="text-[11px] text-text-muted mt-1">{t('admin.userMigration.noUsersHint')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {filteredUsers.map((user) => {
                  const isMigratingUser = migratingUserIds.has(user.id)
                  const currentTypeId = user.user_type_id
                  const currentTypeName = user.user_type?.name || getUserTypeName(currentTypeId)
                  const migrationResult = latestResultByUser[user.id]
                  const selected = selectedUserIds.has(user.id)
                  const alreadyTarget = targetMigrationTypeId !== null && currentTypeId === targetMigrationTypeId
                  const avatarColor = getUserAvatarColor(user.id)
                  const primaryLabel = user.pubkey
                    ? formatPubkeyShort(user.pubkey)
                    : t('admin.userMigration.userLabel', { id: user.id })

                  return (
                      <div
                        key={user.id}
                        className={`bg-surface border rounded-lg p-3 transition-all ${
                          selected
                            ? 'border-accent/40 bg-accent/5 shadow-sm'
                            : 'border-border hover:border-border-strong hover:shadow-xs'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => handleToggleUserSelection(user.id)}
                            className="mt-1 rounded border-border text-accent focus:ring-accent/30"
                          />

                          {/* Avatar */}
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${avatarColor.bg}`}>
                            <User className={`w-4 h-4 ${avatarColor.text}`} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className={`text-sm font-medium text-text ${user.pubkey ? 'font-mono' : ''}`}>
                                {primaryLabel}
                              </p>
                              <span className="text-[10px] text-text-muted font-mono">#{user.id}</span>

                              {/* Type badge with icon */}
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border bg-surface-overlay text-text-muted border-border">
                                {user.user_type?.icon && (
                                  <DynamicIcon name={user.user_type.icon} className="w-3 h-3" />
                                )}
                                {currentTypeName}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {/* Approval status */}
                              {user.approved ? (
                                <span className="inline-flex items-center gap-1 text-xs text-success">
                                  <ShieldCheck className="w-3 h-3" />
                                  {t('admin.userMigration.approved')}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-warning">
                                  <Shield className="w-3 h-3" />
                                  {t('admin.userMigration.pendingApproval')}
                                </span>
                              )}

                              {user.created_at && (
                                <span className="text-[11px] text-text-muted">
                                  {new Date(user.created_at).toLocaleDateString()}
                                </span>
                              )}

                              {/* Compact encrypted data indicators */}
                              <div className="flex items-center gap-1.5">
                                {user.pubkey && (
                                  <span title={t('admin.userMigration.pubkeyPresent')}>
                                    <Key className="w-3 h-3 text-text-muted" />
                                  </span>
                                )}
                                {user.email_encrypted?.ciphertext && (
                                  <span title={t('admin.userMigration.emailEncryptedHint')}>
                                    <Mail className="w-3 h-3 text-text-muted" />
                                  </span>
                                )}
                                {user.name_encrypted?.ciphertext && (
                                  <span title={t('admin.userMigration.nameEncryptedHint')}>
                                    <Lock className="w-3 h-3 text-text-muted" />
                                  </span>
                                )}
                              </div>
                            </div>

                            {migrationResult && (
                              <p className={`text-xs mt-1 ${migrationResult.success ? 'text-accent' : 'text-error'}`}>
                                {migrationResult.success
                                  ? t('admin.userMigration.rowResultSuccess', {
                                      count: migrationResult.missing_required_count ?? 0,
                                    })
                                  : migrationResult.error || t('admin.userMigration.rowResultFailed')}
                                {!!migrationResult.missing_required_fields?.length && (
                                  ` (${migrationResult.missing_required_fields.join(', ')})`
                                )}
                              </p>
                            )}
                          </div>

                          <button
                            onClick={() => handleMigrateSingleUser(user.id)}
                            disabled={isMigratingUser || isBatchMigrating || !targetMigrationTypeId || alreadyTarget}
                            className="inline-flex items-center gap-2 border border-border text-text rounded-lg px-2.5 py-1.5 text-xs hover:bg-surface-overlay transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title={alreadyTarget ? t('admin.userMigration.alreadyTarget') : t('admin.userMigration.migrateUser')}
                          >
                            {isMigratingUser && <Loader2 className="w-3 h-3 animate-spin" />}
                            {t('admin.userMigration.migrateOne')}
                          </button>
                        </div>
                      </div>
                    )
                })}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-3">
            <Link
              to="/admin/setup"
              className="flex-1 flex items-center justify-center gap-2 border border-border hover:border-accent/50 text-text rounded-xl px-4 py-3 text-sm font-medium transition-all hover:bg-surface"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back', 'Back')}
            </Link>
          </div>

          {/* User Types & Fields Help Modal */}
          {showUserHelpModal && (
            <div
              ref={userHelpModalRef}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="user-help-modal-title"
              onKeyDown={handleModalKeyDown}
              tabIndex={-1}
            >
              <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 id="user-help-modal-title" className="text-lg font-semibold text-text flex items-center gap-2">
                    <HelpCircle className="w-5 h-5" />
                    {USER_HELP_PAGES[userHelpPage].title}
                  </h3>
                  <button
                    onClick={handleCloseUserHelpModal}
                    className="text-text-muted hover:text-text transition-colors"
                    aria-label={t('common.close', 'Close')}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Content */}
                <div className="min-h-[280px]">
                  {USER_HELP_PAGES[userHelpPage].content === 'overview' ? (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.overviewDesc', 'User Types and User Fields work together to create a customized onboarding experience for your users.')}
                      </p>
                      <div className="bg-surface-overlay border border-border rounded-lg p-4">
                        <p className="text-sm font-medium text-text mb-2">{t('admin.userHelp.twoTier', 'The two-tier system:')}</p>
                        <ul className="text-xs text-text-muted space-y-2 list-disc list-inside">
                          <li><strong>{t('admin.userHelp.userTypes', 'User Types')}</strong> - {t('admin.userHelp.userTypesExplain', 'Categories of users (e.g., "Student", "Teacher", "Researcher")')}</li>
                          <li><strong>{t('admin.userHelp.userFields', 'User Fields')}</strong> - {t('admin.userHelp.userFieldsExplain', 'Questions shown during onboarding (e.g., "Email", "Department")')}</li>
                        </ul>
                      </div>
                      <p className="text-xs text-text-muted">
                        {t('admin.userHelp.overviewNote', 'Fields can be global (shown to all users) or specific to a user type.')}
                      </p>
                    </div>
                  ) : USER_HELP_PAGES[userHelpPage].content === 'types' ? (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.typesDesc', 'User Types let you segment your audience and customize their experience.')}
                      </p>
                      <div className="space-y-2">
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.whenToUse', 'When to create user types:')}</p>
                          <ul className="text-xs text-text-muted mt-2 space-y-1 list-disc list-inside">
                            <li>{t('admin.userHelp.useCase1', 'Different user groups need different information collected')}</li>
                            <li>{t('admin.userHelp.useCase2', 'You want to personalize the AI\'s responses by user role')}</li>
                            <li>{t('admin.userHelp.useCase3', 'Analytics should be segmented by user category')}</li>
                          </ul>
                        </div>
                        <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                          <p className="text-xs text-accent">
                            {t('admin.userHelp.typesExample', 'Example: A university might have "Student", "Faculty", and "Staff" types, each with different fields like "Year of Study" or "Department".')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : USER_HELP_PAGES[userHelpPage].content === 'fields' ? (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.fieldsDesc', 'Each field type serves a different purpose:')}
                      </p>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">text</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldText', 'Short text input (name, title)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">email</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldEmail', 'Email with validation')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">textarea</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldTextarea', 'Multi-line text (bio, notes)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">select</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldSelect', 'Dropdown with predefined options')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">checkbox</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldCheckbox', 'Yes/no toggle (consent, preferences)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">number</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldNumber', 'Numeric input (age, quantity)')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">date</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldDate', 'Date picker')}</p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-2">
                          <p className="text-sm font-medium text-text">url</p>
                          <p className="text-xs text-text-muted">{t('admin.userHelp.fieldUrl', 'Website URL with validation')}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-text-muted mb-4">
                        {t('admin.userHelp.tipsDesc', 'Best practices for a great onboarding experience:')}
                      </p>
                      <div className="space-y-2">
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.tipRequired', 'Required vs Optional')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('admin.userHelp.tipRequiredDesc', 'Only mark fields as required if you truly need them. More optional fields = higher completion rates.')}
                          </p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.tipOrder', 'Field Ordering')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('admin.userHelp.tipOrderDesc', 'Put the most important fields first. Users are more likely to complete early fields.')}
                          </p>
                        </div>
                        <div className="bg-surface-overlay border border-border rounded-lg p-3">
                          <p className="text-sm font-medium text-text">{t('admin.userHelp.tipGlobal', 'Global Fields')}</p>
                          <p className="text-xs text-text-muted mt-1">
                            {t('admin.userHelp.tipGlobalDesc', 'Fields without a user type are shown to everyone. Use these for universal information like email.')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                  <button
                    onClick={() => setUserHelpPage((prev) => Math.max(0, prev - 1))}
                    disabled={userHelpPage === 0}
                    className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t('common.previous', 'Previous')}
                  </button>

                  {/* Page indicators */}
                  <div className="flex items-center gap-1.5">
                    {USER_HELP_PAGES.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setUserHelpPage(index)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          index === userHelpPage
                            ? 'bg-accent'
                            : 'bg-border hover:bg-text-muted'
                        }`}
                        aria-label={`${t('common.goToPage', 'Go to page')} ${index + 1}`}
                      />
                    ))}
                  </div>

                  <button
                    onClick={() => setUserHelpPage((prev) => Math.min(USER_HELP_PAGES.length - 1, prev + 1))}
                    disabled={userHelpPage === USER_HELP_PAGES.length - 1}
                    className="flex items-center gap-1 text-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('common.next', 'Next')}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </OnboardingCard>
  )
}
