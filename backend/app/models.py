"""
Sanctum Pydantic Models
Request and response models for user/admin management.
"""

from pydantic import BaseModel
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
    field_type: str  # 'text', 'number', 'boolean', 'email', 'url', etc.
    required: bool = False
    display_order: int = 0
    user_type_id: Optional[int] = None  # None = global field (shown for all types)


class FieldDefinitionUpdate(BaseModel):
    """Request model for updating a field definition"""
    field_name: Optional[str] = None
    field_type: Optional[str] = None
    required: Optional[bool] = None
    display_order: Optional[int] = None
    user_type_id: Optional[int] = None


class FieldDefinitionResponse(BaseModel):
    """Response model for field definition"""
    id: int
    field_name: str
    field_type: str
    required: bool
    display_order: int
    user_type_id: Optional[int] = None  # None = global field
    created_at: Optional[str] = None


class FieldDefinitionListResponse(BaseModel):
    """Response model for list of field definitions"""
    fields: list[FieldDefinitionResponse]


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
