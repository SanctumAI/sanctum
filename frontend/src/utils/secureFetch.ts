const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])
const DEFAULT_CSRF_COOKIE_NAME = 'sanctum_csrf'

let installed = false

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const encodedName = encodeURIComponent(name)
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const [rawKey, ...rawValueParts] = part.trim().split('=')
    if (rawKey === encodedName || rawKey === name) {
      return decodeURIComponent(rawValueParts.join('=') || '')
    }
  }
  return null
}

function isApiRequest(url: URL): boolean {
  const apiBase = import.meta.env.VITE_API_BASE || '/api'
  const apiBaseUrl = new URL(apiBase, window.location.origin)
  const basePath = apiBaseUrl.pathname.endsWith('/') && apiBaseUrl.pathname !== '/'
    ? apiBaseUrl.pathname.slice(0, -1)
    : apiBaseUrl.pathname

  if (url.origin !== apiBaseUrl.origin) {
    return false
  }

  if (basePath === '/') {
    return true
  }

  return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)
}

export function installSecureFetch(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalFetch = window.fetch.bind(window)
  const csrfCookieName = import.meta.env.VITE_CSRF_COOKIE_NAME || DEFAULT_CSRF_COOKIE_NAME

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined
    const inputUrl = request?.url || (input instanceof URL ? input.href : String(input))
    const url = new URL(inputUrl, window.location.origin)

    if (!isApiRequest(url)) {
      return originalFetch(input, init)
    }

    const method = (init?.method || request?.method || 'GET').toUpperCase()
    const headers = request ? new Headers(request.headers) : new Headers()
    if (init?.headers) {
      const initHeaders = new Headers(init.headers)
      initHeaders.forEach((value, key) => {
        headers.set(key, value)
      })
    }

    if (!SAFE_METHODS.has(method)) {
      const csrfToken = getCookie(csrfCookieName)
      if (csrfToken && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', csrfToken)
      }
    }

    const mergedInit: RequestInit = {
      ...init,
      headers,
      credentials: init?.credentials || request?.credentials || 'include',
    }

    return originalFetch(input, mergedInit)
  }
}
