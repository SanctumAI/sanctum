# Instance Initiation (Admin-First Gating)

Sanctum instances require a first admin to "initiate" the instance before users can begin the user onboarding flow.
This avoids confusing UX (users attempting to sign in to an instance that has not been set up yet) and provides a
single, clear place to communicate instance status and next steps.

## Backend Contract

Frontend relies on `GET /instance/status` (public) to determine initiation / readiness.

Expected response shape (subset used by the frontend today):

```json
{
  "initialized": true,
  "setup_complete": true,
  "ready_for_users": true,
  "settings": {}
}
```

Notes:

- `initialized`: whether an admin exists for this instance (initiation completed).
- `setup_complete`: whether admin setup has been completed.
- `ready_for_users`: whether the instance should allow user onboarding (future: can be used to gate user routes more granularly).
- `settings`: instance branding/settings payload (currently treated as an opaque object in this feature).

## Frontend Implementation

### 1) Cached status fetch helper

`frontend/src/utils/instanceStatus.ts`

- Provides `fetchInstanceStatus()` with an in-memory cache to avoid repeated network calls during a single SPA session.
- Uses a conservative fallback: if the status fetch fails (backend unreachable), it assumes "initiated" to avoid hard-locking the UI.

### 2) Root redirect checks instance initiation

`frontend/src/pages/HomeRedirect.tsx`

- On mount: fetches instance status.
- If `initialized === false`, redirects to `/admin`.
- Otherwise proceeds with normal auth-based redirect logic (`useAuthFlow()`).

### 3) Public-route gate for user routes

`frontend/src/components/shared/InitiationGate.tsx`

- Wraps public user routes.
- While checking: shows a minimal loading screen.
- If uninitiated: redirects to `/admin`.
- If initiated: renders the route as normal.

Wiring lives in `frontend/src/App.tsx` by wrapping the user flow routes (`/login`, `/auth`, `/verify`, etc).

### 4) Admin onboarding shows an initiation wizard when needed

`frontend/src/pages/AdminOnboarding.tsx`

- Fetches instance status.
- If `initialized === false`: shows a 3-step initiation wizard ("What this is" → "How you sign in" → "Initiate").
- If initiated: shows the existing admin login UI and flow.

## UX Principles / Tradeoffs

- Root-level gating keeps the logic centralized and avoids sprinkling instance-status checks throughout individual pages.
- Conservative fallback avoids locking out users on transient backend/network issues, at the cost of potentially showing user routes briefly during outages.
- This feature currently treats `settings` as opaque; branding continues to come from `InstanceConfigProvider` (`/settings/public`).

## Follow-Ups (Likely)

- Consider using `ready_for_users` and/or `setup_complete` to gate user onboarding more precisely (e.g., show a "waiting for admin setup" page).
- Decide whether `/settings/public` and `/instance/status` should be consolidated on the backend or unified in a single frontend context.

