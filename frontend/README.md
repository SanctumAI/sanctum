# Sanctum Frontend

React-based frontend for the Sanctum RAG system.

## Tech Stack

- **React 18** + TypeScript
- **Vite** for development and builds
- **Tailwind CSS v4** with custom warm neutral theme
- **react-router-dom** for routing
- **react-markdown** + remark-gfm for markdown rendering
- **lucide-react** for icons
- **i18next** + react-i18next for internationalization (31 languages)

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | HomeRedirect | Smart redirect based on auth state |
| `/test-dashboard` | TestDashboard | Developer testing dashboard |
| `/chat` | ChatPage | Main chat interface with RAG |
| `/admin` | AdminOnboarding | Admin login via Nostr NIP-07 |
| `/admin/setup` | AdminSetup | Admin dashboard (links to config areas) |
| `/admin/instance` | AdminInstanceConfig | Branding, theme, and chat style |
| `/admin/users` | AdminUserConfig | User types and onboarding fields |
| `/admin/ai` | AdminAIConfig | Prompt sections, parameters, document defaults |
| `/admin/deployment` | AdminDeploymentConfig | LLM/SMTP/domains/SSL configuration |
| `/admin/upload` | AdminDocumentUpload | Upload documents to knowledge base |
| `/admin/database` | AdminDatabaseExplorer | View and manage SQLite data |
| `/login` | UserOnboarding | Language selector (first onboarding step) |
| `/auth` | UserAuth | User signup/login via magic link |
| `/user-type` | UserTypeSelection | Select a user type (if multiple) |
| `/verify` | VerifyMagicLink | Magic link verification |
| `/profile` | UserProfile | Complete custom profile fields |
| `/pending` | PendingApproval | Waiting page for unapproved users |

## Authentication Flows

### Admin Flow (Nostr NIP-07)

```text
/admin → Connect with Nostr → /admin/setup → /admin/instance | /admin/users | /admin/ai | /admin/deployment → /admin/upload or /admin/database
```

1. Admin navigates to `/admin`
2. Clicks "Connect with Nostr" (requires NIP-07 browser extension like Alby)
3. Extension prompts for public key approval
4. On success, redirected to `/admin/setup` (admin dashboard)
5. From the dashboard, navigate to:
   - `/admin/instance` - Branding, theme, and chat style
   - `/admin/users` - User types and onboarding fields
   - `/admin/ai` - Prompts, parameters, document defaults
   - `/admin/deployment` - LLM/SMTP/domains/SSL configuration
   - `/admin/upload` - Upload documents to the knowledge base (PDF, TXT, MD)
   - `/admin/database` - View and manage SQLite database tables

**What is NIP-07?**
NIP-07 is a Nostr standard that allows websites to request your public key from a browser extension. It provides passwordless, cryptographically-secure authentication where you control your own keys.

### User Flow (Magic Link)

```
/login → Select language → /auth → Enter email → Check inbox → Click link → /verify → /user-type (if needed) → /profile (if needed) → /chat
```

1. User navigates to `/login`
2. Selects preferred language from 31 available options (searchable grid)
3. Language selection updates UI immediately and is saved to localStorage
4. Clicks Continue to proceed to `/auth`
5. Enters name (signup) or email (login)
6. Receives magic link via email
7. Clicks link, redirected to `/verify`
8. If multiple user types exist, redirected to `/user-type`
9. If custom fields configured, redirected to `/profile` to complete them
10. If user is not approved, redirected to `/pending`
11. On completion, redirected to `/chat`

## LocalStorage Keys

| Key | Purpose |
|-----|---------|
| `sanctum_admin_pubkey` | Admin's Nostr public key |
| `sanctum_admin_session_token` | Admin session token |
| `sanctum_user_email` | Verified user email |
| `sanctum_user_name` | User's display name |
| `sanctum_custom_fields` | Admin-configured custom fields schema |
| `sanctum_user_profile` | User's completed profile data |
| `sanctum_pending_email` | Email awaiting verification |
| `sanctum_pending_name` | Name awaiting verification |
| `sanctum_session_token` | User session token |
| `sanctum_user_type_id` | Selected user type ID |
| `sanctum_user_approved` | User approval status (see Security Note below) |
| `sanctum_instance_config` | Instance branding configuration |
| `sanctum_language` | User's selected language code (e.g., "en", "es", "ja") |

### Security Considerations

**Session Tokens**: Session tokens (`sanctum_session_token`, `sanctum_admin_session_token`) are stored in localStorage for simplicity. In XSS scenarios, an attacker could access these tokens. For production deployments with high security requirements, consider implementing httpOnly cookie-based sessions.

**Approval Status**: The `sanctum_user_approved` localStorage value controls UI routing only. Approval status is validated server-side on each API request—unauthorized API access returns 403 Forbidden.

## Instance Branding

Admins can fully customize the instance branding at `/admin/instance`:

### Display Name
Custom name shown in headers and onboarding screens (default: "Sanctum").

### Icon
Choose from 60+ curated Lucide icons for the instance logo. Icons are searchable and organized by category.

### Logo URL (Optional)
Provide a square image URL to replace the Lucide icon in the header and onboarding screens. If the image fails to load, the UI falls back to the selected icon.

### Favicons (Optional)
Set a `faviconUrl` and `appleTouchIconUrl` to update the browser tab icon and iOS home screen icon. The browser tab title always mirrors the instance name.

### Accent Color
Six theme colors available:

| Color | Light Mode | Dark Mode |
|-------|------------|-----------|
| Blue (default) | `#2563eb` | `#3b82f6` |
| Purple | `#7c3aed` | `#8b5cf6` |
| Green | `#059669` | `#10b981` |
| Orange | `#ea580c` | `#f97316` |
| Pink | `#db2777` | `#ec4899` |
| Teal | `#0d9488` | `#14b8a6` |

### Configuration Schema

```typescript
interface InstanceConfig {
  name: string
  accentColor: string
  icon: string
  logoUrl: string
  faviconUrl: string
  appleTouchIconUrl: string
  assistantIcon: string
  userIcon: string
  assistantName: string
  userLabel: string
  headerLayout: string
  headerTagline: string
  chatBubbleStyle: string
  chatBubbleShadow: boolean
  surfaceStyle: string
  statusIconSet: string
  typographyPreset: string
}
```

#### Field Reference

| Field | Type | Valid Values | Description |
|-------|------|--------------|-------------|
| `name` | string | Any text | Instance display name shown in headers and onboarding |
| `accentColor` | string | `"blue"`, `"purple"`, `"green"`, `"orange"`, `"pink"`, `"teal"` | Theme accent color |
| `icon` | string | Lucide icon names | Instance icon (e.g., `"shield"`, `"book"`) |
| `logoUrl` | string | URL | Custom logo image URL (falls back to icon if empty or fails to load) |
| `faviconUrl` | string | URL | Browser tab icon (recommended 32x32 or 64x64) |
| `appleTouchIconUrl` | string | URL | iOS home screen icon (recommended 180x180) |
| `assistantIcon` | string | Lucide icon names | Icon shown next to AI messages |
| `userIcon` | string | Lucide icon names | Icon shown next to user messages |
| `assistantName` | string | Any text | Display name above AI messages (empty to hide) |
| `userLabel` | string | Any text | Label above user messages (empty to hide) |
| `headerLayout` | string | `"icon_name"`, `"icon_only"`, `"name_only"` | How to display branding in header |
| `headerTagline` | string | Any text | Optional subtitle under instance name |
| `chatBubbleStyle` | string | `"soft"`, `"round"`, `"square"`, `"pill"` | Chat message bubble shape |
| `chatBubbleShadow` | boolean | `true`/`false` | Whether bubbles have drop shadow |
| `surfaceStyle` | string | `"plain"`, `"gradient"`, `"noise"`, `"grid"` | Background texture style |
| `statusIconSet` | string | `"classic"`, `"minimal"`, `"playful"` | Status indicator icon style |
| `typographyPreset` | string | `"modern"`, `"grotesk"`, `"humanist"` | Font family pairing |

## Internationalization (i18n)

The app supports 31 languages via `react-i18next`. Users select their language on the first onboarding screen.

### Supported Languages

| Code | Language | Code | Language |
|------|----------|------|----------|
| en | English | ko | Korean |
| es | Spanish | ar | Arabic |
| pt | Portuguese | fa | Persian (Farsi) |
| fr | French | hi | Hindi |
| de | German | bn | Bengali |
| it | Italian | id | Indonesian |
| nl | Dutch | th | Thai |
| ru | Russian | vi | Vietnamese |
| zh-Hans | Chinese (Simplified) | tr | Turkish |
| zh-Hant | Chinese (Traditional) | pl | Polish |
| ja | Japanese | uk | Ukrainian |
| el | Greek | sv, no, da, fi | Nordic languages |
| cs | Czech | he | Hebrew |
| hu | Hungarian | ro | Romanian |

### Translation Files

Translation files are located in `src/i18n/locales/`:

```
src/i18n/
├── index.ts           # i18n configuration
└── locales/
    ├── en.json        # English (base)
    ├── es.json        # Spanish
    ├── fa.json        # Persian (Farsi)
    ├── ja.json        # Japanese
    └── ...            # 27 more languages
```

### Adding Translations

1. Edit the language file in `src/i18n/locales/{code}.json`
2. Follow the existing key structure:
   ```json
   {
     "onboarding": {
       "language": { ... },
       "auth": { ... },
       "verify": { ... },
       "profile": { ... }
     },
     "common": { ... }
   }
   ```
3. Use `{{variable}}` syntax for interpolation (e.g., `"Welcome, {{name}}!"`)

### Using Translations in Components

```tsx
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t } = useTranslation()

  return <h1>{t('onboarding.auth.welcomeBackTitle')}</h1>
}
```

## Custom Fields

Admins can configure custom fields that users must complete during onboarding. Supported field types:

| Type | Description |
|------|-------------|
| `text` | Single-line text input |
| `email` | Email with validation |
| `number` | Numeric input |
| `textarea` | Multi-line text |
| `select` | Dropdown with options |
| `checkbox` | Boolean toggle |
| `date` | Date picker |
| `url` | URL with validation |

## Project Structure

```
src/
├── components/
│   ├── chat/           # Chat interface components
│   │   ├── ChatContainer.tsx
│   │   ├── ChatInput.tsx
│   │   ├── ChatMessage.tsx
│   │   ├── DocumentScope.tsx
│   │   ├── ExportButton.tsx
│   │   ├── MessageList.tsx
│   │   └── ToolSelector.tsx
│   ├── onboarding/     # Auth/onboarding components
│   │   ├── ColorPicker.tsx
│   │   ├── DynamicField.tsx
│   │   ├── FieldEditor.tsx
│   │   ├── IconPicker.tsx
│   │   ├── NostrInfo.tsx
│   │   └── OnboardingCard.tsx
│   └── shared/         # Shared components
│       └── DynamicIcon.tsx
├── context/
│   └── InstanceConfigContext.tsx
├── i18n/               # Internationalization
│   ├── index.ts        # i18n configuration
│   └── locales/        # Translation files (31 languages)
│       ├── en.json
│       ├── es.json
│       └── ...
├── pages/
│   ├── AdminDatabaseExplorer.tsx  # SQLite database viewer
│   ├── AdminDocumentUpload.tsx    # Document upload for RAG
│   ├── AdminOnboarding.tsx
│   ├── AdminSetup.tsx
│   ├── ChatPage.tsx
│   ├── TestDashboard.tsx
│   ├── UserAuth.tsx      # Login/signup form
│   ├── UserOnboarding.tsx # Language selector
│   ├── UserProfile.tsx
│   └── VerifyMagicLink.tsx
├── theme/
│   ├── index.ts          # Theme exports
│   └── ThemeProvider.tsx
├── types/
│   ├── database.ts     # Database explorer types
│   ├── ingest.ts       # Document ingest API types
│   ├── instance.ts
│   └── onboarding.ts
├── utils/
│   ├── exportChat.ts
│   └── languages.ts    # Language definitions
├── App.tsx
├── index.css
└── main.tsx
```

## Theme

The app uses a warm neutral color palette with blue accents. Theme variables are defined in `index.css` and support both light and dark modes via the `ThemeProvider`.

## Building

```bash
npm run build
```

Output is in the `dist/` directory.
