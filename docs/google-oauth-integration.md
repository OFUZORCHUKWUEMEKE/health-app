# Google Sign-In — Frontend Integration Guide

How to wire the patient-only Google OAuth flow into your UI.

## TL;DR

- Backend owns the OAuth dance. The frontend just sends the user to one URL and reads the query string on the way back.
- Start: `GET {API_BASE}/auth/google` (browser redirect, not fetch).
- End: browser lands on `{FRONTEND_URL}/auth/google?token=...&refresh_token=...&role=patient` on success, or `?error=...` on failure.
- Google sign-in only creates / logs in **patients**. Doctors and admins are rejected with a clear error message.

## The flow

```
[User clicks button]
        │
        ▼
GET /api/v1/auth/google  ─────►  Google consent screen
                                        │
                                        ▼
                         GET /api/v1/auth/google/callback
                                        │
                                        ▼
                 302 → {FRONTEND_URL}/auth/google?token=…&refresh_token=…&role=patient
                                 (or ?error=…)
```

The backend sets `FRONTEND_URL` via env (default `http://localhost:5173`). Make sure that value points at the origin your SPA is served from.

## Step 1 — The sign-in button

Anywhere in your app. A full-page navigation (not `fetch`, not XHR) — OAuth needs the browser's own redirects and cookies.

```tsx
// apiBase = e.g. "https://api.example.com/api/v1"  or  "http://localhost:3000/api/v1"
export function GoogleSignInButton({ apiBase }: { apiBase: string }) {
  const handleClick = () => {
    window.location.href = `${apiBase}/auth/google`;
  };

  return (
    <button type="button" onClick={handleClick} className="...">
      Continue with Google
    </button>
  );
}
```

Don't use `fetch`, `axios`, or `window.open` with a popup — the Google consent page can't be framed, and you'll lose the redirect chain.

## Step 2 — The callback page

You need a route at `/auth/google` on the frontend that reads the query string and either stores the tokens or shows the error.

```tsx
// React Router v6 example — pages/AuthGoogleCallback.tsx
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthGoogleCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const error = params.get('error');
    const token = params.get('token');
    const refreshToken = params.get('refresh_token');
    const role = params.get('role');

    if (error) {
      // Show to user via toast / inline error / dedicated error page.
      // Typical message: "This email is registered as a doctor..."
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }

    if (!token || !refreshToken || !role) {
      navigate('/login?error=Missing+auth+response', { replace: true });
      return;
    }

    // Persist. Use whatever storage your app already uses for session tokens.
    localStorage.setItem('access_token', token);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('role', role);

    navigate('/dashboard', { replace: true });
  }, [params, navigate]);

  return <div>Signing you in…</div>;
}
```

Register it:

```tsx
<Route path="/auth/google" element={<AuthGoogleCallback />} />
```

## Step 3 — Use the tokens

The access token is a standard JWT issued by the same endpoint as email/password login — same shape, same lifetime (`JWT_ACCESS_EXPIRATION`, currently **7 days**). Send it on every authenticated request:

```ts
headers: { Authorization: `Bearer ${accessToken}` }
```

When it expires, refresh with:

```
POST /api/v1/auth/refresh
{ "refreshToken": "...", "role": "patient" }
```

(Same refresh path you already use for password login.)

## Errors you can get

All failures come back as `?error=<message>` on the callback redirect. Surface the string as-is — it's already user-readable.

| Scenario | Query string |
| --- | --- |
| Email already registered as a doctor | `?error=This email is registered as a doctor. Google sign-in is only available for patients — please use email/password login.` |
| Email already registered as an admin | `?error=This email is registered as an admin. Google sign-in is only available for patients — please use email/password login.` |
| Google account has no email | `?error=Google account email is missing` |
| Passport / Google handshake fails | `?error=No user from Google` (or a generic error string) |

## What the backend does under the hood (for context)

On a successful Google callback, the backend:

1. Pulls `email`, `given_name`, `family_name`, `picture` from the Google profile.
2. Rejects the email if it already belongs to a doctor or admin account.
3. Looks up a patient by email:
   - **Found** → marks the account `provider: GOOGLE`, `verified: true`, backfills `profile_picture_url` if missing.
   - **Not found** → creates a new patient with `provider: GOOGLE`, `verified: true`, a fresh `registration_no`, and an MRN, then sends the welcome email.
4. Issues access + refresh tokens with role `patient` and stores a hashed copy of the refresh token on the user doc.

You don't need to call anything else after the redirect — the user is fully signed in as soon as you have the tokens in hand.

## Environment checklist

Backend `.env`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3000/api/v1/auth/google/callback
FRONTEND_URL=http://localhost:5173
```

In the Google Cloud console, the authorized redirect URI must match `GOOGLE_CALLBACK_URL` **exactly** (protocol, host, port, path). Add one entry per environment (local, staging, prod).

Frontend expected routes:

- A button that navigates to `{API_BASE}/auth/google`.
- A page mounted at `/auth/google` that reads `token`, `refresh_token`, `role`, and `error` from the query string.

## Common gotchas

- **Popup blockers** — don't open the OAuth URL in a popup. Use top-level navigation.
- **CORS** — this flow does not use CORS; it's a full-page redirect. If you see a CORS error, you're calling `/auth/google` with `fetch` instead of `window.location`.
- **Mixed origins** — if `FRONTEND_URL` points at a different origin than the app the user is currently on, the tokens still land, but your cookies/storage won't. Serve the callback page from the same origin as the rest of the app.
- **Mobile / WebView** — Google blocks OAuth in embedded WebViews. Use the system browser (e.g. `react-native-inappbrowser-reborn`'s "external browser" mode, or `expo-auth-session` handling the redirect back via a deep link you set as `FRONTEND_URL`).
- **Trailing slashes** — the redirect URI in Google Cloud is matched byte-for-byte. `/callback` and `/callback/` are different entries.
