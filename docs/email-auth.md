# Email Authentication Configuration

Sanctum uses magic link email authentication. Users enter their email address, receive a link, and click it to sign in. No passwords required.

## How It Works

1. **User requests sign-in**: Submits email address to `/auth/magic-link`
2. **Token generated**: A signed, time-limited token is created using `itsdangerous`
3. **Email sent**: Magic link with token is sent via SMTP (or logged in mock mode)
4. **User clicks link**: Frontend receives token via URL query parameter
5. **Token verified**: Backend validates signature and expiration (15 minutes)
6. **Session created**: A 7-day session token is returned to the frontend

**Setup requirement:** Magic link endpoints are disabled until an admin has authenticated at least once. If no admin exists, `/auth/magic-link` returns `503` ("Instance not configured").

## Configuration

Configuration can be set via environment variables **or** the admin deployment UI (`/admin/deployment`).
Deployment config values stored in SQLite take precedence over environment variables at runtime.
See `docs/admin-deployment-config.md` for UI behavior, validation, and restart rules.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MOCK_EMAIL` | Set to `false` for production (canonical key) | `false` |
| `SMTP_HOST` | SMTP server hostname | `smtp.mailgun.org` |
| `SMTP_PORT` | SMTP port (usually 587 for TLS) | `587` |
| `SMTP_USER` | SMTP username/login | `postmaster@mg.example.com` |
| `SMTP_PASS` | SMTP password or API key | `your-smtp-password` |
| `SMTP_FROM` | From address for emails | `Sanctum <noreply@example.com>` |
| `FRONTEND_URL` | Your production frontend URL | `https://app.example.com` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Token signing key (auto-generated if not set) | Auto-generated |
| `SMTP_TIMEOUT` | SMTP connection timeout (seconds) | `10` |

> **Note:** `MOCK_SMTP` is a deployment config UI alias for `MOCK_EMAIL`. If both are set, `MOCK_EMAIL` takes precedence. Use `MOCK_EMAIL` when setting environment variables directly.

## Development Mode

For local development, leave `MOCK_EMAIL=true` (or set `MOCK_SMTP=true` in deployment config). Magic links will be logged to the console instead of sent via email:

```
============================================================
MAGIC LINK (mock mode - no email sent)
To: user@example.com
URL: http://localhost:5173/verify?token=eyJhbGc...
============================================================
```

## Test Email Endpoint

Admins can send a test email to verify SMTP settings:

```bash
curl -X POST http://localhost:8000/auth/test-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"email": "you@example.com"}'
```

If mock mode is enabled (`MOCK_EMAIL=true` or `MOCK_SMTP=true`), the response indicates no email was actually sent.

## Provider Configuration Examples

### Gmail

Gmail requires an "App Password" (not your regular password). Generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).

```bash
MOCK_EMAIL=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourname@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx    # 16-character App Password
SMTP_FROM=Sanctum <yourname@gmail.com>
```

**Note**: Gmail has sending limits (~500/day for personal accounts). Not recommended for high-volume production use.

### Mailgun

Create an account at [mailgun.com](https://www.mailgun.com/). Free tier includes 100 emails/day (~3,000/month).

```bash
MOCK_EMAIL=false
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.yourdomain.com
SMTP_PASS=your-mailgun-smtp-password
SMTP_FROM=Sanctum <noreply@mg.yourdomain.com>
```

Find SMTP credentials in: Mailgun Dashboard > Sending > Domain Settings > SMTP credentials

### SendGrid

Create an account at [sendgrid.com](https://sendgrid.com/). Offers a 60-day free trial (100 emails/day). No ongoing free tier after trial ends.

```bash
MOCK_EMAIL=false
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey                    # Literally the word "apikey"
SMTP_PASS=SG.xxxxxxxxxxxxxxxxxxxx   # Your API key starting with SG.
SMTP_FROM=Sanctum <noreply@yourdomain.com>
```

Create an API key in: SendGrid Dashboard > Settings > API Keys

### Amazon SES

Cost-effective for high volume (~$0.10 per 1,000 emails). Requires AWS account.

```bash
MOCK_EMAIL=false
SMTP_HOST=email-smtp.us-east-1.amazonaws.com   # Use your region
SMTP_PORT=587
SMTP_USER=AKIAIOSFODNN7EXAMPLE      # SES SMTP username (not IAM access key)
SMTP_PASS=wJalrXUtnFEMI/K7MDENG...  # SES SMTP password
SMTP_FROM=Sanctum <noreply@yourdomain.com>
```

**Important**:
- The FROM address must be verified in SES
- New accounts start in sandbox mode (can only send to verified addresses)
- Request production access to send to any address

Generate SMTP credentials in: AWS Console > SES > SMTP Settings > Create SMTP credentials

### Postmark

Known for high deliverability. Create account at [postmarkapp.com](https://postmarkapp.com/).

```bash
MOCK_EMAIL=false
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=your-server-api-token
SMTP_PASS=your-server-api-token     # Same as user
SMTP_FROM=Sanctum <noreply@yourdomain.com>
```

Find the Server API Token in: Postmark > Servers > Your Server > API Tokens

### Brevo (formerly Sendinblue)

Free tier includes 300 emails/day. Create account at [brevo.com](https://www.brevo.com/).

```bash
MOCK_EMAIL=false
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-email@example.com
SMTP_PASS=your-smtp-key
SMTP_FROM=Sanctum <noreply@yourdomain.com>
```

Generate SMTP key in: Brevo > Settings > SMTP & API

## Security Considerations

### Secret Key Management

The `SECRET_KEY` is used to sign magic link and session tokens. If it changes, all existing tokens become invalid.

**Behavior:**
1. If `SECRET_KEY` environment variable is set, it's used
2. Otherwise, checks for `/data/.secret_key` file (persisted across restarts)
3. If neither exists, generates a new key and saves it to `/data/.secret_key`

**For production:**
- Either set `SECRET_KEY` explicitly in your environment
- Or ensure `/data/` is a persistent volume so the auto-generated key survives deployments

### Token Expiration

| Token Type | Expiration |
|------------|------------|
| Magic link | 15 minutes |
| Session | 7 days |

### Rate Limiting

The `/auth/magic-link` endpoint is rate-limited to 5 requests per minute per IP address to prevent abuse.

## Troubleshooting

### Emails not sending

1. Check that `MOCK_EMAIL=false` (or `MOCK_SMTP=false` in deployment config) is set
2. Verify `SMTP_HOST` is not empty
3. Check backend logs for SMTP errors: `docker compose -f docker-compose.infra.yml -f docker-compose.app.yml logs backend`
4. Test SMTP credentials with a tool like `swaks` or your provider's test feature

### "Invalid or expired token" errors

1. Token may have expired (15-minute limit)
2. `SECRET_KEY` may have changed between token generation and verification
3. Check that frontend and backend are using the same `FRONTEND_URL`

### Emails going to spam

1. Set up SPF, DKIM, and DMARC records for your domain
2. Use a reputable transactional email provider
3. Ensure `SMTP_FROM` uses a verified domain
4. Avoid spam trigger words in email content (the default template is designed to avoid this)

## File Reference

- `backend/app/auth.py` - Authentication logic, token generation, SMTP sending
- `backend/app/main.py` - API endpoints (`/auth/magic-link`, `/auth/verify`, `/auth/me`)
- `frontend/src/pages/UserAuth.tsx` - Login form
- `frontend/src/pages/VerifyMagicLink.tsx` - Token verification page
