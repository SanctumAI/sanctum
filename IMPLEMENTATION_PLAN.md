# Optional Field Encryption - Implementation Plan

## 🎯 **Goal**
Allow admins to configure encryption on a per-field basis while maintaining secure-by-default behavior.

## 📋 **Requirements**
1. Add `encryption_enabled` flag to field definitions  
2. Default: `encryption_enabled = true` (secure by default)
3. Admin UI to toggle encryption per field
4. Respect encryption setting during data storage
5. Handle mixed encrypted/plaintext data gracefully
6. Support migration scenarios  
7. Maintain backward compatibility
8. Clear security warnings for disabled encryption

---

## 🗄️ **1. Database Schema Changes**

### **A. Add encryption_enabled to user_field_definitions**
```sql
-- Migration: Add encryption_enabled column
ALTER TABLE user_field_definitions 
ADD COLUMN encryption_enabled INTEGER DEFAULT 1;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_field_definitions_encryption 
ON user_field_definitions(encryption_enabled);
```

### **B. Updated Schema**
```sql
user_field_definitions:
  id INTEGER PRIMARY KEY
  field_name TEXT NOT NULL
  field_type TEXT NOT NULL  
  required INTEGER DEFAULT 0
  placeholder TEXT
  options TEXT
  user_type_id INTEGER
  encryption_enabled INTEGER DEFAULT 1  -- ✅ NEW: 1=encrypt, 0=plaintext
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

---

## 🔧 **2. Database Functions Updates**

### **A. Field Definition Management**
```python
def create_field_definition(
    field_name: str,
    field_type: str, 
    user_type_id: int,
    encryption_enabled: bool = True  # ✅ Secure default
) -> int:
    """Create field definition with encryption preference"""
    
def update_field_definition_encryption(
    field_id: int,
    encryption_enabled: bool
) -> bool:
    """Update encryption setting for existing field"""
    # ⚠️ SECURITY: Log encryption changes for audit
    # ⚠️ MIGRATION: Handle existing data appropriately
```

### **B. Enhanced Field Storage Logic**
```python
def set_user_field(user_id: int, field_name: str, value: object, user_type_id: int):
    """Set field value with conditional encryption"""
    field_def = get_field_definition_by_name(field_name, user_type_id)
    
    if field_def["encryption_enabled"]:
        # ✅ ENCRYPTED PATH (existing logic)
        encrypted_value, ephemeral_pubkey = encrypt_for_admin_required(value)
        store_encrypted(user_id, field_def["id"], encrypted_value, ephemeral_pubkey)
    else:
        # ⚠️ PLAINTEXT PATH (new logic)
        store_plaintext(user_id, field_def["id"], value)
```

### **C. Enhanced Field Retrieval Logic** 
```python
def get_user(user_id: int) -> dict:
    """Get user with mixed encrypted/plaintext fields"""
    # Handle both encrypted and plaintext fields gracefully
    for field in user_fields:
        if field["encrypted_value"]:
            # Encrypted field - provide for NIP-07 decryption
            user["fields_encrypted"][field_name] = {
                "ciphertext": field["encrypted_value"],
                "ephemeral_pubkey": field["ephemeral_pubkey"]
            }
        else:
            # Plaintext field - return directly
            user["fields"][field_name] = field["value"]
```

---

## 🌐 **3. API Endpoint Changes**

### **A. Field Definition Endpoints**
```python
# ✅ UPDATE: Include encryption_enabled in responses
@app.get("/admin/field-definitions")
async def list_field_definitions():
    return [
        {
            "id": field["id"],
            "field_name": field["field_name"],
            "field_type": field["field_type"], 
            "encryption_enabled": field["encryption_enabled"],  # ✅ NEW
            "required": field["required"],
            ...
        }
    ]

# ✅ NEW: Encryption control endpoint  
@app.put("/admin/field-definitions/{field_id}/encryption")
async def update_field_encryption(
    field_id: int,
    encryption_request: FieldEncryptionRequest,
    admin: dict = Depends(auth.require_admin)
):
    """Toggle encryption for a field definition"""
    # ⚠️ SECURITY: Audit log for encryption changes
    # ⚠️ VALIDATION: Check for existing data impacts
```

### **B. Enhanced Models**
```python
class FieldDefinitionResponse(BaseModel):
    id: int
    field_name: str
    field_type: str
    encryption_enabled: bool  # ✅ NEW
    required: bool = False
    placeholder: str | None = None
    options: str | None = None

class FieldEncryptionRequest(BaseModel):
    encryption_enabled: bool
    force: bool = False  # Override warnings about existing data
```

---

## 🎨 **4. Frontend Admin UI**

### **A. Field Definition Management**
```typescript
// Enhanced field definition interface
interface FieldDefinition {
  id: number;
  field_name: string;
  field_type: string;
  encryption_enabled: boolean;  // ✅ NEW
  required: boolean;
  placeholder?: string;
  options?: string;
}

// Encryption toggle component
const EncryptionToggle = ({ field, onUpdate }) => {
  const [enabled, setEnabled] = useState(field.encryption_enabled);
  
  return (
    <div className="encryption-control">
      <label>
        <input 
          type="checkbox" 
          checked={enabled}
          onChange={(e) => handleEncryptionToggle(field.id, e.target.checked)}
        />
        Encrypt this field
      </label>
      {!enabled && (
        <div className="security-warning">
          ⚠️ Field data will be stored in plaintext
        </div>
      )}
    </div>
  );
};
```

### **B. Field Definition Page Updates**
- Add encryption toggle to each field definition
- Show security warnings for disabled encryption
- Batch encryption management for multiple fields
- Clear visual indicators for encrypted vs plaintext fields

---

## 🔄 **5. Migration Strategy**

### **A. Database Migration**
```python
def _migrate_add_encryption_enabled_column():
    """Add encryption_enabled column with secure defaults"""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Check if column exists
    cursor.execute("PRAGMA table_info(user_field_definitions)")
    columns = [row[1] for row in cursor.fetchall()]
    
    if "encryption_enabled" not in columns:
        # Add column with secure default (1 = encrypted)
        cursor.execute("""
            ALTER TABLE user_field_definitions 
            ADD COLUMN encryption_enabled INTEGER DEFAULT 1
        """)
        
        # Create index for performance
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_field_definitions_encryption 
            ON user_field_definitions(encryption_enabled)
        """)
        
        conn.commit()
        logger.info("Added encryption_enabled column to field definitions")
```

### **B. Data Migration Considerations**
```python
def migrate_field_encryption_setting(field_id: int, new_encryption_enabled: bool):
    """Handle migration when encryption setting changes"""
    # ⚠️ COMPLEX: Convert between encrypted/plaintext formats
    # ⚠️ SECURITY: Handle decryption securely 
    # ⚠️ PERFORMANCE: Batch process for large datasets
    
    if new_encryption_enabled:
        # PLAINTEXT → ENCRYPTED
        migrate_plaintext_to_encrypted(field_id)
    else:
        # ENCRYPTED → PLAINTEXT  
        # ⚠️ DANGEROUS: Requires admin confirmation
        migrate_encrypted_to_plaintext(field_id)
```

---

## 🔒 **6. Security Considerations**

### **A. Secure Defaults**
- ✅ **Default**: `encryption_enabled = true`
- ✅ **Warning**: Clear UI warnings for disabled encryption
- ✅ **Audit**: Log all encryption setting changes
- ✅ **Confirmation**: Require admin confirmation for disabling encryption

### **B. Data Protection**
```python
# Security validations
def validate_encryption_change(field_id: int, new_setting: bool) -> ValidationResult:
    """Validate encryption setting changes"""
    existing_data = check_existing_field_data(field_id)
    
    if existing_data and not new_setting:
        return ValidationResult(
            valid=False,
            warning="⚠️ Disabling encryption will expose existing user data in plaintext",
            requires_confirmation=True
        )
    
    return ValidationResult(valid=True)
```

### **C. Audit Trail**
```python
def log_encryption_change(admin_id: int, field_id: int, old_setting: bool, new_setting: bool):
    """Log encryption setting changes for security audit"""
    logger.security(
        f"Admin {admin_id} changed field {field_id} encryption: {old_setting} → {new_setting}"
    )
```

---

## 🧪 **7. Testing Strategy**

### **A. Unit Tests**
```python
def test_field_encryption_enabled_by_default():
    """Test secure defaults"""
    field = create_field_definition("phone", "text")
    assert field["encryption_enabled"] == True

def test_mixed_encrypted_plaintext_retrieval():
    """Test handling mixed encryption in same user"""
    # Field 1: encrypted
    # Field 2: plaintext  
    # Verify both retrieved correctly

def test_encryption_setting_change():
    """Test encryption toggle functionality"""
    # Toggle encryption on/off
    # Verify data handling
```

### **B. Integration Tests**
```python
def test_admin_encryption_ui():
    """Test admin UI for encryption management"""
    # Test field definition page
    # Test encryption toggles
    # Test security warnings

def test_field_encryption_migration():
    """Test data migration between encryption states"""
    # Create plaintext field data
    # Enable encryption
    # Verify migration to encrypted format
```

### **C. Security Tests** 
```python
def test_plaintext_exposure_warnings():
    """Test security warnings for plaintext fields"""
    # Verify warnings shown
    # Verify confirmation required
    
def test_audit_logging():
    """Test encryption change audit trail"""
    # Verify all changes logged
    # Verify log format and content
```

---

## 📦 **8. Implementation Order**

### **Phase 1: Core Infrastructure**
1. ✅ Database schema changes (`encryption_enabled` column)
2. ✅ Migration scripts for existing installations  
3. ✅ Enhanced field definition functions
4. ✅ Updated field storage/retrieval logic

### **Phase 2: API & Models**
1. ✅ Enhanced API responses with encryption status
2. ✅ New encryption toggle endpoint
3. ✅ Updated Pydantic models
4. ✅ Security validation functions

### **Phase 3: Frontend**
1. ✅ Admin UI encryption toggles
2. ✅ Security warnings for plaintext fields
3. ✅ Enhanced field definition management
4. ✅ Visual indicators for encryption status

### **Phase 4: Testing & Polish**
1. ✅ Comprehensive test suite
2. ✅ Security audit and validation
3. ✅ Documentation and admin guides
4. ✅ Performance optimization

---

## ⚡ **Success Metrics**

### **Functionality**
- ✅ Admins can toggle encryption per field
- ✅ Secure-by-default behavior maintained
- ✅ Mixed encrypted/plaintext data handled gracefully
- ✅ No breaking changes to existing functionality

### **Security** 
- ✅ Clear warnings for plaintext fields
- ✅ Audit trail for encryption changes
- ✅ No accidental exposure of sensitive data
- ✅ Secure migration between encryption states

### **UX**
- ✅ Intuitive admin interface
- ✅ Clear visual encryption indicators  
- ✅ Helpful security guidance
- ✅ Smooth field management workflow

---

**Ready to implement! This plan provides granular encryption control while maintaining Sanctum's security-first approach.** 🔒✨