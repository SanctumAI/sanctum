"""
Sanctum Pydantic Models
Request and response models for user/admin management.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# --- Admin Models ---

class AdminAuth(BaseModel):
    """Legacy request model for admin authentication (deprecated)"""
    pubkey: str


class AdminResponse(BaseModel):
    """Response model for admin data"""
    id: int
    pubkey: str
    created_at: Optional[str] = None


class AdminListResponse(BaseModel):
    """Response model for list of admins"""
    admins: list[AdminResponse]


# --- Nostr Auth Models ---

class NostrEvent(BaseModel):
    """A signed Nostr event (NIP-01)"""
    id: str
    pubkey: str
    created_at: int
    kind: int
    tags: list[list[str]]
    content: str
    sig: str


class AdminAuthRequest(BaseModel):
    """Request model for admin authentication with signed Nostr event"""
    event: NostrEvent


class AdminAuthResponse(BaseModel):
    """Response model for successful admin authentication"""
    admin: AdminResponse
    is_new: bool
    instance_initialized: bool
    session_token: str


# --- Instance Settings Models ---

class InstanceSettings(BaseModel):
    """Instance settings model"""
    instance_name: Optional[str] = None
    primary_color: Optional[str] = None
    description: Optional[str] = None

    class Config:
        extra = "allow"  # Allow arbitrary additional settings


class InstanceSettingsResponse(BaseModel):
    """Response model for instance settings"""
    settings: dict


class InstanceStatusResponse(BaseModel):
    """Response model for instance status and setup state"""
    initialized: bool  # Whether an admin has been configured
    setup_complete: bool = False  # Whether admin has completed setup/auth
    ready_for_users: bool = False  # Whether users can register/login
    settings: dict = Field(default_factory=dict)  # Public instance settings


# --- User Type Models ---

class UserTypeCreate(BaseModel):
    """Request model for creating a user type"""
    name: str
    description: Optional[str] = None
    display_order: int = 0


class UserTypeUpdate(BaseModel):
    """Request model for updating a user type"""
    name: Optional[str] = None
    description: Optional[str] = None
    display_order: Optional[int] = None


class UserTypeResponse(BaseModel):
    """Response model for user type data"""
    id: int
    name: str
    description: Optional[str] = None
    display_order: int
    created_at: Optional[str] = None


class UserTypeListResponse(BaseModel):
    """Response model for list of user types"""
    types: list[UserTypeResponse]


# --- User Field Definition Models ---

class FieldDefinitionCreate(BaseModel):
    """Request model for creating a user field definition"""
    field_name: str
    field_type: str  # 'text', 'number', 'boolean', 'email', 'url', 'select', etc.
    required: bool = False
    display_order: int = 0
    user_type_id: Optional[int] = None  # None = global field (shown for all types)
    placeholder: Optional[str] = None  # Placeholder text for input
    options: Optional[list[str]] = None  # Options for select fields
    encryption_enabled: bool = True  # Secure default: encrypt field values


class FieldDefinitionUpdate(BaseModel):
    """Request model for updating a field definition"""
    field_name: Optional[str] = None
    field_type: Optional[str] = None
    required: Optional[bool] = None
    display_order: Optional[int] = None
    user_type_id: Optional[int] = None
    placeholder: Optional[str] = None
    options: Optional[list[str]] = None
    encryption_enabled: Optional[bool] = None  # Toggle encryption for field


class FieldDefinitionResponse(BaseModel):
    """Response model for field definition"""
    id: int
    field_name: str
    field_type: str
    required: bool
    display_order: int
    user_type_id: Optional[int] = None  # None = global field
    placeholder: Optional[str] = None
    options: Optional[list[str]] = None
    encryption_enabled: bool = True  # Whether field values are encrypted
    created_at: Optional[str] = None


class FieldDefinitionListResponse(BaseModel):
    """Response model for list of field definitions"""
    fields: list[FieldDefinitionResponse]


class FieldEncryptionRequest(BaseModel):
    """Request model for updating field encryption setting"""
    encryption_enabled: bool
    force: bool = False  # Override warnings about existing data


class FieldEncryptionResponse(BaseModel):
    """Response model for field encryption update"""
    field_id: int
    encryption_enabled: bool
    warning: Optional[str] = None
    migrated_values: Optional[int] = None  # Number of values migrated


# --- Encrypted Data Models ---

class EncryptedField(BaseModel):
    """Encrypted field data for NIP-04 decryption"""
    ciphertext: str  # NIP-04 format: base64(encrypted)?iv=base64(iv)
    ephemeral_pubkey: str  # x-only pubkey (hex) for ECDH


# --- User Models ---

class UserCreate(BaseModel):
    """Request model for creating a user"""
    pubkey: Optional[str] = None
    email: Optional[str] = None      # Auth email (encrypted, enables email lookups)
    name: Optional[str] = None       # User's name (encrypted)
    user_type_id: Optional[int] = None  # Which user type they selected
    fields: dict = {}  # Dynamic fields defined by admin


class UserUpdate(BaseModel):
    """Request model for updating a user"""
    pubkey: Optional[str] = None
    fields: dict = {}


class UserResponse(BaseModel):
    """Response model for user data.

    Encrypted fields are returned in *_encrypted properties.
    Plaintext fields (email, name) are only populated for legacy unencrypted data.
    """
    id: int
    pubkey: Optional[str] = None
    email: Optional[str] = None  # Plaintext (legacy only)
    name: Optional[str] = None   # Plaintext (legacy only)
    email_encrypted: Optional[EncryptedField] = None  # NIP-04 encrypted
    name_encrypted: Optional[EncryptedField] = None   # NIP-04 encrypted
    user_type_id: Optional[int] = None
    user_type: Optional[UserTypeResponse] = None  # Nested type info
    approved: bool = True
    created_at: Optional[str] = None
    fields: dict = {}  # Plaintext (legacy only)
    fields_encrypted: dict = {}  # NIP-04 encrypted field values


class UserListResponse(BaseModel):
    """Response model for list of users"""
    users: list[UserResponse]


# --- Magic Link Auth Models ---

class MagicLinkRequest(BaseModel):
    """Request model for sending a magic link"""
    email: str
    name: str = ""


class MagicLinkResponse(BaseModel):
    """Response model for magic link request"""
    success: bool
    message: str


class VerifyTokenRequest(BaseModel):
    """Request model for verifying a magic link token"""
    token: str


class AuthUserResponse(BaseModel):
    """Response model for authenticated user"""
    id: int
    email: str
    name: Optional[str] = None
    user_type_id: Optional[int] = None
    approved: bool = True
    created_at: Optional[str] = None


class VerifyTokenResponse(BaseModel):
    """Response model for successful verification"""
    success: bool
    user: AuthUserResponse
    session_token: str


class SessionUserResponse(BaseModel):
    """Response model for /auth/me endpoint"""
    user: Optional[AuthUserResponse] = None
    authenticated: bool


# --- Generic Response Models ---

class SuccessResponse(BaseModel):
    """Generic success response"""
    success: bool
    message: str


class ErrorResponse(BaseModel):
    """Generic error response"""
    error: str
    detail: Optional[str] = None


# --- Database Explorer Models ---

class ColumnInfo(BaseModel):
    """Column definition for a table"""
    name: str
    type: str  # SQLite types: TEXT, INTEGER, REAL, BLOB, NULL
    nullable: bool
    primaryKey: bool
    defaultValue: Optional[str] = None


class TableInfo(BaseModel):
    """Table metadata"""
    name: str
    columns: list[ColumnInfo]
    rowCount: int


class TablesListResponse(BaseModel):
    """Response model for list of tables"""
    tables: list[TableInfo]


class TableDataResponse(BaseModel):
    """Response model for table data (paginated)"""
    table: str
    columns: list[ColumnInfo]
    rows: list[dict]
    totalRows: int
    page: int
    pageSize: int
    totalPages: int


class DBQueryRequest(BaseModel):
    """Request model for SQL query execution"""
    sql: str


class DBQueryResponse(BaseModel):
    """Response model for SQL query execution"""
    success: bool
    columns: list[str] = []
    rows: list[dict] = []
    rowsAffected: Optional[int] = None
    lastInsertId: Optional[int] = None
    error: Optional[str] = None
    executionTimeMs: Optional[int] = None


class RowMutationRequest(BaseModel):
    """Request model for inserting/updating a row"""
    data: dict


class RowMutationResponse(BaseModel):
    """Response model for row mutations"""
    success: bool
    id: Optional[int] = None
    error: Optional[str] = None


# --- AI Configuration Models ---

class AIConfigItem(BaseModel):
    """Single AI config item"""
    key: str
    value: str
    value_type: str  # 'string', 'number', 'boolean', 'json'
    category: str  # 'prompt_section', 'parameter', 'default'
    description: Optional[str] = None
    updated_at: Optional[str] = None


class AIConfigResponse(BaseModel):
    """Response model for AI config grouped by category"""
    prompt_sections: list[AIConfigItem] = []
    parameters: list[AIConfigItem] = []
    defaults: list[AIConfigItem] = []


class AIConfigUpdate(BaseModel):
    """Request model for updating an AI config value"""
    value: str


class PromptPreviewRequest(BaseModel):
    """Request model for previewing assembled prompt"""
    sample_question: str = "What should I know about this topic?"
    sample_facts: dict = {}


class PromptPreviewResponse(BaseModel):
    """Response model for prompt preview"""
    assembled_prompt: str
    sections_used: list[str]


class SessionDefaultsResponse(BaseModel):
    """Response model for public session defaults"""
    web_search_enabled: bool = False
    default_document_ids: list[str] = []


# --- AI Config User-Type Override Models ---

class AIConfigWithInheritance(BaseModel):
    """AI config item with inheritance information"""
    key: str
    value: str
    value_type: str  # 'string', 'number', 'boolean', 'json'
    category: str  # 'prompt_section', 'parameter', 'default'
    description: Optional[str] = None
    updated_at: Optional[str] = None
    is_override: bool = False
    override_user_type_id: Optional[int] = None


class AIConfigOverrideItem(BaseModel):
    """Single AI config override for a user type"""
    key: str
    value: str
    user_type_id: int
    updated_at: Optional[str] = None


class AIConfigUserTypeResponse(BaseModel):
    """Response model for AI config with user-type inheritance"""
    user_type_id: int
    user_type_name: Optional[str] = None
    prompt_sections: list[AIConfigWithInheritance] = []
    parameters: list[AIConfigWithInheritance] = []
    defaults: list[AIConfigWithInheritance] = []


class AIConfigOverrideUpdate(BaseModel):
    """Request model for updating an AI config override"""
    value: str


# --- Document Defaults Models ---

class DocumentDefaultItem(BaseModel):
    """Single document default item"""
    job_id: str
    filename: Optional[str] = None
    status: Optional[str] = None
    total_chunks: Optional[int] = None
    is_available: bool = True
    is_default_active: bool = True
    display_order: int = 0
    updated_at: Optional[str] = None


class DocumentDefaultsResponse(BaseModel):
    """Response model for list of document defaults"""
    documents: list[DocumentDefaultItem]


class DocumentDefaultUpdate(BaseModel):
    """Request model for updating document defaults"""
    is_available: Optional[bool] = None
    is_default_active: Optional[bool] = None
    display_order: Optional[int] = None


class DocumentDefaultBatchItem(BaseModel):
    """Single item in a batch update"""
    job_id: str
    is_available: Optional[bool] = None
    is_default_active: Optional[bool] = None
    display_order: Optional[int] = None


class DocumentDefaultsBatchUpdate(BaseModel):
    """Request model for batch updating document defaults"""
    updates: list[DocumentDefaultBatchItem]


# --- Document Defaults User-Type Override Models ---

class DocumentDefaultWithInheritance(BaseModel):
    """Document default item with inheritance information"""
    job_id: str
    filename: Optional[str] = None
    status: Optional[str] = None
    total_chunks: Optional[int] = None
    is_available: bool = True
    is_default_active: bool = True
    display_order: int = 0
    updated_at: Optional[str] = None
    is_override: bool = False
    override_user_type_id: Optional[int] = None
    override_updated_at: Optional[str] = None


class DocumentDefaultsUserTypeResponse(BaseModel):
    """Response model for document defaults with user-type inheritance"""
    user_type_id: int
    user_type_name: Optional[str] = None
    documents: list[DocumentDefaultWithInheritance]


class DocumentDefaultOverrideUpdate(BaseModel):
    """Request model for updating document defaults override"""
    is_available: Optional[bool] = None
    is_default_active: Optional[bool] = None


# --- Deployment Configuration Models ---

class DeploymentConfigItem(BaseModel):
    """Single deployment config item"""
    key: str
    value: Optional[str] = None
    is_secret: bool = False
    requires_restart: bool = False
    category: str
    description: Optional[str] = None
    updated_at: Optional[str] = None


class DeploymentConfigResponse(BaseModel):
    """Response model for deployment config grouped by category"""
    llm: list[DeploymentConfigItem] = []
    embedding: list[DeploymentConfigItem] = []
    email: list[DeploymentConfigItem] = []
    storage: list[DeploymentConfigItem] = []
    security: list[DeploymentConfigItem] = []
    search: list[DeploymentConfigItem] = []
    general: list[DeploymentConfigItem] = []


class DeploymentConfigUpdate(BaseModel):
    """Request model for updating a deployment config value"""
    value: str


class ServiceHealthItem(BaseModel):
    """Health status for a single service"""
    name: str
    status: str  # 'healthy', 'unhealthy', 'unknown'
    response_time_ms: Optional[int] = None
    last_checked: Optional[str] = None
    error: Optional[str] = None


class ServiceHealthResponse(BaseModel):
    """Response model for service health"""
    services: list[ServiceHealthItem]
    restart_required: bool = False
    changed_keys_requiring_restart: list[str] = []


class DeploymentValidationResponse(BaseModel):
    """Response model for config validation"""
    valid: bool
    errors: list[str] = []
    warnings: list[str] = []


# --- Config Audit Log Models ---

class ConfigAuditLogEntry(BaseModel):
    """Single audit log entry"""
    id: int
    table_name: str
    config_key: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_by: str
    changed_at: str


class ConfigAuditLogResponse(BaseModel):
    """Response model for audit log"""
    entries: list[ConfigAuditLogEntry]


# --- Test Email Models ---

class TestEmailRequest(BaseModel):
    """Request model for sending a test email"""
    email: str


class TestEmailResponse(BaseModel):
    """Response model for test email result"""
    success: bool
    message: str
    error: Optional[str] = None
