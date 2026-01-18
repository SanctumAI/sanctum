"""
Sanctum Pydantic Models
Request and response models for user/admin management.
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# --- Admin Models ---

class AdminAuth(BaseModel):
    """Request model for admin authentication"""
    pubkey: str


class AdminResponse(BaseModel):
    """Response model for admin data"""
    id: int
    pubkey: str
    created_at: Optional[str] = None


class AdminListResponse(BaseModel):
    """Response model for list of admins"""
    admins: list[AdminResponse]


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


# --- User Models ---

class UserCreate(BaseModel):
    """Request model for creating a user"""
    pubkey: Optional[str] = None
    user_type_id: Optional[int] = None  # Which user type they selected
    fields: dict = {}  # Dynamic fields defined by admin


class UserUpdate(BaseModel):
    """Request model for updating a user"""
    pubkey: Optional[str] = None
    fields: dict = {}


class UserResponse(BaseModel):
    """Response model for user data"""
    id: int
    pubkey: Optional[str] = None
    user_type_id: Optional[int] = None
    user_type: Optional[UserTypeResponse] = None  # Nested type info
    created_at: Optional[str] = None
    fields: dict = {}


class UserListResponse(BaseModel):
    """Response model for list of users"""
    users: list[UserResponse]


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
