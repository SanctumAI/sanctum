/**
 * TypeScript types for Admin Configuration System
 */

import type { TFunction } from 'i18next'

// --- AI Configuration Types ---

export interface AIConfigItem {
  key: string
  value: string
  value_type: 'string' | 'number' | 'boolean' | 'json'
  category: 'prompt_section' | 'parameter' | 'default'
  description?: string
  updated_at?: string
}

export interface AIConfigResponse {
  prompt_sections: AIConfigItem[]
  parameters: AIConfigItem[]
  defaults: AIConfigItem[]
}

export interface AIConfigUpdate {
  value: string
}

// --- AI Config User-Type Override Types ---

export interface AIConfigWithInheritance {
  key: string
  value: string
  value_type: 'string' | 'number' | 'boolean' | 'json'
  category: 'prompt_section' | 'parameter' | 'default'
  description?: string
  updated_at?: string
  is_override: boolean
  override_user_type_id?: number
}

export interface AIConfigOverrideItem {
  key: string
  value: string
  user_type_id: number
  updated_at?: string
}

export interface AIConfigUserTypeResponse {
  user_type_id: number
  user_type_name?: string
  prompt_sections: AIConfigWithInheritance[]
  parameters: AIConfigWithInheritance[]
  defaults: AIConfigWithInheritance[]
}

export interface AIConfigOverrideUpdate {
  value: string
}

export interface PromptPreviewRequest {
  sample_question?: string
  sample_facts?: Record<string, string>
}

export interface PromptPreviewResponse {
  assembled_prompt: string
  sections_used: string[]
}

// --- Document Defaults Types ---

export interface DocumentDefaultItem {
  job_id: string
  filename?: string
  status?: string
  total_chunks?: number
  is_available: boolean
  is_default_active: boolean
  display_order: number
  updated_at?: string
}

export interface DocumentDefaultsResponse {
  documents: DocumentDefaultItem[]
}

export interface DocumentDefaultUpdate {
  is_available?: boolean
  is_default_active?: boolean
  display_order?: number
}

export interface DocumentDefaultsBatchUpdate {
  updates: Array<{
    job_id: string
    is_available?: boolean
    is_default_active?: boolean
    display_order?: number
  }>
}

// --- Document Defaults User-Type Override Types ---

export interface DocumentDefaultWithInheritance {
  job_id: string
  filename?: string
  status?: string
  total_chunks?: number
  is_available: boolean
  is_default_active: boolean
  display_order: number
  updated_at?: string
  is_override: boolean
  override_user_type_id?: number
  override_updated_at?: string
}

export interface DocumentDefaultsUserTypeResponse {
  user_type_id: number
  user_type_name?: string
  documents: DocumentDefaultWithInheritance[]
}

export interface DocumentDefaultOverrideUpdate {
  is_available?: boolean
  is_default_active?: boolean
}

// --- Deployment Configuration Types ---

export interface DeploymentConfigItem {
  key: string
  value?: string
  is_secret: boolean
  requires_restart: boolean
  category: string
  description?: string
  updated_at?: string
}

export interface DeploymentConfigResponse {
  llm: DeploymentConfigItem[]
  embedding: DeploymentConfigItem[]
  email: DeploymentConfigItem[]
  storage: DeploymentConfigItem[]
  security: DeploymentConfigItem[]
  search: DeploymentConfigItem[]
  general: DeploymentConfigItem[]
}

export interface DeploymentConfigUpdate {
  value: string
}

export interface ServiceHealthItem {
  name: string
  status: 'healthy' | 'unhealthy' | 'unknown'
  response_time_ms?: number
  last_checked?: string
  error?: string
}

export interface ServiceHealthResponse {
  services: ServiceHealthItem[]
  restart_required: boolean
  changed_keys_requiring_restart: string[]
}

export interface DeploymentValidationResponse {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// --- Config Audit Log Types ---

export interface ConfigAuditLogEntry {
  id: number
  table_name: string
  config_key: string
  old_value?: string
  new_value?: string
  changed_by: string
  changed_at: string
}

export interface ConfigAuditLogResponse {
  entries: ConfigAuditLogEntry[]
}

// --- Key Migration Types ---

export interface EncryptedUserData {
  id: number
  encrypted_email?: string
  ephemeral_pubkey_email?: string
  encrypted_name?: string
  ephemeral_pubkey_name?: string
}

export interface EncryptedFieldValue {
  id: number
  user_id: number
  field_id: number
  encrypted_value?: string
  ephemeral_pubkey?: string
}

export interface MigrationPrepareResponse {
  admin_pubkey: string
  users: EncryptedUserData[]
  field_values: EncryptedFieldValue[]
  user_count: number
  field_value_count: number
}

export interface DecryptedUserData {
  id: number
  email?: string
  name?: string
}

export interface DecryptedFieldValue {
  id: number
  value?: string
}

export interface MigrationExecuteRequest {
  new_admin_pubkey: string
  users: DecryptedUserData[]
  field_values: DecryptedFieldValue[]
  signature_event: NostrEvent
}

export interface MigrationExecuteResponse {
  success: boolean
  message: string
  users_migrated: number
  field_values_migrated: number
}

// Nostr event for signing
export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

// --- Config Categories for UI ---

export interface ConfigCategoryMeta {
  label: string
  description: string
  hint: string
}

export const CONFIG_CATEGORY_KEYS = ['llm', 'embedding', 'email', 'storage', 'security', 'search', 'general'] as const

export type ConfigCategory = typeof CONFIG_CATEGORY_KEYS[number]

/**
 * Returns translated config category metadata
 */
export function getConfigCategories(t: TFunction): Record<ConfigCategory, ConfigCategoryMeta> {
  return {
    llm: {
      label: t('configCategories.llm.label', 'AI Provider'),
      description: t('configCategories.llm.description', 'Connect to your AI service'),
      hint: t('configCategories.llm.hint', "Configure which AI service powers your assistant. You'll need an API key from your chosen provider (e.g., OpenAI, Anthropic). Changes require a service restart to take effect."),
    },
    embedding: {
      label: t('configCategories.embedding.label', 'Text Processing'),
      description: t('configCategories.embedding.description', 'Configure how documents are analyzed'),
      hint: t('configCategories.embedding.hint', "These settings control how your documents are converted into searchable data. The defaults work well for most cases — only change if you're using a custom model."),
    },
    email: {
      label: t('configCategories.email.label', 'Email Service'),
      description: t('configCategories.email.description', 'Set up email for user authentication'),
      hint: t('configCategories.email.hint', "Configure email for sending magic links to users during sign-in. You'll need SMTP credentials from an email service like SendGrid, Mailgun, or your own mail server."),
    },
    storage: {
      label: t('configCategories.storage.label', 'Data Storage'),
      description: t('configCategories.storage.description', 'Configure where data is stored'),
      hint: t('configCategories.storage.hint', "Control file paths for the database and uploaded documents. These typically don't need to change unless you're customizing your deployment."),
    },
    security: {
      label: t('configCategories.security.label', 'Security & URLs'),
      description: t('configCategories.security.description', 'Configure access and security settings'),
      hint: t('configCategories.security.hint', 'Set your public URLs and security options. The frontend URL is where users access the app. Make sure these match your actual deployment.'),
    },
    search: {
      label: t('configCategories.search.label', 'Web Search'),
      description: t('configCategories.search.description', 'Enable AI web search capabilities'),
      hint: t('configCategories.search.hint', "Configure the search engine that powers the AI's web search feature. When enabled, the AI can look up current information online."),
    },
    general: {
      label: t('configCategories.general.label', 'General'),
      description: t('configCategories.general.description', 'Other configuration options'),
      hint: t('configCategories.general.hint', "Miscellaneous settings that don't fit into other categories."),
    },
  }
}

// --- Prompt Section Keys ---

export interface PromptSectionMeta {
  label: string
  description: string
  hint: string
  placeholder: string
}

export const PROMPT_SECTION_KEY_LIST = ['prompt_tone', 'prompt_rules', 'prompt_forbidden', 'prompt_greeting'] as const

export type PromptSectionKey = typeof PROMPT_SECTION_KEY_LIST[number]

/**
 * Returns translated prompt section metadata
 */
export function getPromptSectionMeta(t: TFunction): Record<PromptSectionKey, PromptSectionMeta> {
  return {
    prompt_tone: {
      label: t('promptSections.prompt_tone.label', 'Tone & Personality'),
      description: t('promptSections.prompt_tone.description', 'How the AI should sound when responding'),
      hint: t('promptSections.prompt_tone.hint', 'This sets the overall voice and manner of the AI. For example, you might want it to be "warm and supportive" for a counseling app, or "concise and professional" for a business tool. The AI will use this as guidance for every response.'),
      placeholder: t('promptSections.prompt_tone.placeholder', 'Be helpful, concise, and professional...'),
    },
    prompt_rules: {
      label: t('promptSections.prompt_rules.label', 'Behavioral Rules'),
      description: t('promptSections.prompt_rules.description', 'Specific instructions the AI must follow'),
      hint: t('promptSections.prompt_rules.hint', 'Add rules as a JSON list like ["Always cite sources", "Keep responses under 200 words"]. These are firm guidelines the AI will try to follow in every conversation.'),
      placeholder: t('promptSections.prompt_rules.placeholder', '["Rule 1", "Rule 2", ...]'),
    },
    prompt_forbidden: {
      label: t('promptSections.prompt_forbidden.label', 'Forbidden Topics'),
      description: t('promptSections.prompt_forbidden.description', 'Topics the AI should decline to discuss'),
      hint: t('promptSections.prompt_forbidden.hint', 'List topics you want the AI to politely redirect away from. For example, ["medical advice", "legal counsel"]. The AI will acknowledge these requests but explain it cannot help with them.'),
      placeholder: t('promptSections.prompt_forbidden.placeholder', '["Topic 1", "Topic 2", ...]'),
    },
    prompt_greeting: {
      label: t('promptSections.prompt_greeting.label', 'Response Style'),
      description: t('promptSections.prompt_greeting.description', 'How the AI structures its responses'),
      hint: t('promptSections.prompt_greeting.hint', 'Controls formatting preferences like whether to use bullet points, headers, or conversational paragraphs. This affects how answers are visually presented.'),
      placeholder: t('promptSections.prompt_greeting.placeholder', 'greeting_style'),
    },
  }
}

// --- Parameter Keys ---

export interface ParameterMeta {
  label: string
  description: string
  hint: string
  min: number
  max: number
  step: number
}

export const PARAMETER_KEY_LIST = ['temperature', 'top_k'] as const

export type ParameterKey = typeof PARAMETER_KEY_LIST[number]

/**
 * Returns translated parameter metadata
 */
export function getParameterMeta(t: TFunction): Record<ParameterKey, ParameterMeta> {
  return {
    temperature: {
      label: t('parameters.temperature.label', 'Creativity Level'),
      description: t('parameters.temperature.description', 'How predictable vs. creative the AI responses are'),
      hint: t('parameters.temperature.hint', 'Lower values (0.0-0.3) make responses more focused and consistent — good for factual Q&A. Higher values (0.7-1.0) make responses more varied and creative — better for brainstorming. Default: 0.7'),
      min: 0,
      max: 1,
      step: 0.1,
    },
    top_k: {
      label: t('parameters.top_k.label', 'Knowledge Depth'),
      description: t('parameters.top_k.description', 'How many document sections to reference'),
      hint: t('parameters.top_k.hint', 'When answering questions, the AI searches your uploaded documents and pulls in relevant sections. Higher numbers mean more context but slower responses. Lower numbers are faster but may miss relevant info. Default: 5'),
      min: 1,
      max: 100,
      step: 1,
    },
  }
}

// --- Default Keys ---

export interface DefaultMeta {
  label: string
  description: string
  hint: string
}

export const DEFAULT_KEY_LIST = ['web_search_default'] as const

export type DefaultKey = typeof DEFAULT_KEY_LIST[number]

/**
 * Returns translated default toggle metadata
 */
export function getDefaultMeta(t: TFunction): Record<DefaultKey, DefaultMeta> {
  return {
    web_search_default: {
      label: t('defaults.web_search_default.label', 'Web Search'),
      description: t('defaults.web_search_default.description', 'Allow AI to search the internet'),
      hint: t('defaults.web_search_default.hint', 'When enabled, the AI can search the web for current information not in your documents. Disable this if you want responses to only come from your uploaded knowledge base.'),
    },
  }
}

// --- Deployment Config Item Keys ---

export interface DeploymentConfigItemMeta {
  label: string
  description: string
  hint?: string
}

export const DEPLOYMENT_CONFIG_KEY_LIST = [
  // LLM
  'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_URL', 'RAG_TOP_K', 'PDF_EXTRACT_MODE',
  // Embedding
  'EMBEDDING_MODEL',
  // Email
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'MOCK_SMTP',
  // Storage
  'SQLITE_PATH', 'UPLOADS_DIR', 'QDRANT_HOST', 'QDRANT_PORT',
  // Search
  'SEARXNG_URL',
  // Security
  'FRONTEND_URL',
] as const

export type DeploymentConfigItemKey = typeof DEPLOYMENT_CONFIG_KEY_LIST[number]

/**
 * Returns translated deployment config item metadata
 */
export function getDeploymentConfigItemMeta(t: TFunction): Record<DeploymentConfigItemKey, DeploymentConfigItemMeta> {
  return {
    LLM_PROVIDER: {
      label: t('deploymentConfigItems.LLM_PROVIDER.label', 'AI Service'),
      description: t('deploymentConfigItems.LLM_PROVIDER.description', 'LLM provider (maple, ollama)'),
      hint: t('deploymentConfigItems.LLM_PROVIDER.hint', 'Choose "maple" for the Maple proxy (recommended for privacy) or "ollama" for local models.'),
    },
    LLM_MODEL: {
      label: t('deploymentConfigItems.LLM_MODEL.label', 'Model Name'),
      description: t('deploymentConfigItems.LLM_MODEL.description', 'Model name/identifier'),
      hint: t('deploymentConfigItems.LLM_MODEL.hint', 'The model identifier to use (e.g., "kimi-k2-thinking"). Check your provider\'s documentation for available models.'),
    },
    LLM_API_URL: {
      label: t('deploymentConfigItems.LLM_API_URL.label', 'API Endpoint'),
      description: t('deploymentConfigItems.LLM_API_URL.description', 'Base URL for API requests'),
      hint: t('deploymentConfigItems.LLM_API_URL.hint', 'The base URL for API requests. For Maple: http://maple-proxy:8080/v1. For Ollama: http://localhost:11434.'),
    },
    RAG_TOP_K: {
      label: t('deploymentConfigItems.RAG_TOP_K.label', 'Context Chunks'),
      description: t('deploymentConfigItems.RAG_TOP_K.description', 'Number of chunks to retrieve'),
      hint: t('deploymentConfigItems.RAG_TOP_K.hint', 'How many document chunks to retrieve for each query. Higher = more context but slower. Default: 8.'),
    },
    PDF_EXTRACT_MODE: {
      label: t('deploymentConfigItems.PDF_EXTRACT_MODE.label', 'PDF Processing'),
      description: t('deploymentConfigItems.PDF_EXTRACT_MODE.description', 'PDF extraction method'),
      hint: t('deploymentConfigItems.PDF_EXTRACT_MODE.hint', '"fast" extracts text quickly. "quality" uses OCR for better accuracy with scanned documents but is slower.'),
    },
    EMBEDDING_MODEL: {
      label: t('deploymentConfigItems.EMBEDDING_MODEL.label', 'Embedding Model'),
      description: t('deploymentConfigItems.EMBEDDING_MODEL.description', 'HuggingFace model for embeddings'),
      hint: t('deploymentConfigItems.EMBEDDING_MODEL.hint', 'The HuggingFace model for converting text to vectors. Only change if you need a different language or domain.'),
    },
    SMTP_HOST: {
      label: t('deploymentConfigItems.SMTP_HOST.label', 'Mail Server'),
      description: t('deploymentConfigItems.SMTP_HOST.description', 'SMTP server address'),
      hint: t('deploymentConfigItems.SMTP_HOST.hint', 'Your SMTP server address (e.g., smtp.gmail.com, smtp.sendgrid.net).'),
    },
    SMTP_PORT: {
      label: t('deploymentConfigItems.SMTP_PORT.label', 'Mail Port'),
      description: t('deploymentConfigItems.SMTP_PORT.description', 'SMTP server port'),
      hint: t('deploymentConfigItems.SMTP_PORT.hint', 'Usually 587 for TLS or 465 for SSL. Check your email provider\'s settings.'),
    },
    SMTP_USER: {
      label: t('deploymentConfigItems.SMTP_USER.label', 'SMTP Username'),
      description: t('deploymentConfigItems.SMTP_USER.description', 'Email service username'),
      hint: t('deploymentConfigItems.SMTP_USER.hint', 'Your email service username or API key.'),
    },
    SMTP_PASS: {
      label: t('deploymentConfigItems.SMTP_PASS.label', 'SMTP Password'),
      description: t('deploymentConfigItems.SMTP_PASS.description', 'Email service password'),
      hint: t('deploymentConfigItems.SMTP_PASS.hint', 'Your email service password or API key secret.'),
    },
    SMTP_FROM: {
      label: t('deploymentConfigItems.SMTP_FROM.label', 'Sender Address'),
      description: t('deploymentConfigItems.SMTP_FROM.description', 'From address for emails'),
      hint: t('deploymentConfigItems.SMTP_FROM.hint', 'The "from" address for outgoing emails (e.g., noreply@yourdomain.com).'),
    },
    MOCK_SMTP: {
      label: t('deploymentConfigItems.MOCK_SMTP.label', 'Test Mode'),
      description: t('deploymentConfigItems.MOCK_SMTP.description', 'Mock email sending'),
      hint: t('deploymentConfigItems.MOCK_SMTP.hint', 'When "true", emails are logged instead of sent. Useful for development.'),
    },
    SQLITE_PATH: {
      label: t('deploymentConfigItems.SQLITE_PATH.label', 'Database File'),
      description: t('deploymentConfigItems.SQLITE_PATH.description', 'Path to SQLite database'),
      hint: t('deploymentConfigItems.SQLITE_PATH.hint', 'Path to the SQLite database file. Default: /data/sanctum.db'),
    },
    UPLOADS_DIR: {
      label: t('deploymentConfigItems.UPLOADS_DIR.label', 'Uploads Folder'),
      description: t('deploymentConfigItems.UPLOADS_DIR.description', 'Document uploads directory'),
      hint: t('deploymentConfigItems.UPLOADS_DIR.hint', 'Directory where uploaded documents are stored. Default: /uploads'),
    },
    QDRANT_HOST: {
      label: t('deploymentConfigItems.QDRANT_HOST.label', 'Vector DB Host'),
      description: t('deploymentConfigItems.QDRANT_HOST.description', 'Qdrant server hostname'),
      hint: t('deploymentConfigItems.QDRANT_HOST.hint', 'Hostname for the Qdrant vector database. Default: qdrant'),
    },
    QDRANT_PORT: {
      label: t('deploymentConfigItems.QDRANT_PORT.label', 'Vector DB Port'),
      description: t('deploymentConfigItems.QDRANT_PORT.description', 'Qdrant REST API port'),
      hint: t('deploymentConfigItems.QDRANT_PORT.hint', 'Port for Qdrant (REST API). Default: 6333'),
    },
    SEARXNG_URL: {
      label: t('deploymentConfigItems.SEARXNG_URL.label', 'Search Engine URL'),
      description: t('deploymentConfigItems.SEARXNG_URL.description', 'SearXNG instance URL'),
      hint: t('deploymentConfigItems.SEARXNG_URL.hint', 'URL of your SearXNG instance for web search functionality.'),
    },
    FRONTEND_URL: {
      label: t('deploymentConfigItems.FRONTEND_URL.label', 'App URL'),
      description: t('deploymentConfigItems.FRONTEND_URL.description', 'Public URL for the application'),
      hint: t('deploymentConfigItems.FRONTEND_URL.hint', 'The public URL where users access the app. Used for generating magic links.'),
    },
  }
}
