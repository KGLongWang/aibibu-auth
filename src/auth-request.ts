export const AUTH_REQUEST_STORAGE_KEY = 'aibibu.auth.request'

export type AuthSocialProvider = 'google' | 'custom:linuxdo'

export interface AuthRequest {
  clientId?: string
  redirectUri?: string
  state?: string
  flow?: 'social'
  provider?: AuthSocialProvider
  channelState?: string
}

export interface AuthResult {
  accessToken: string
  expiresAt?: number
}

export interface AuthSuccessMessage {
  type: 'aibibu.auth.success'
  access_token: string
  expires_at?: number
  state?: string
}

export interface SocialAuthSuccessMessage {
  type: 'aibibu.auth.social.success'
  access_token: string
  expires_at?: number
  state: string
}

export interface SocialAuthErrorMessage {
  type: 'aibibu.auth.social.error'
  error: string
  state: string
}

export interface OAuthRestartMessage {
  type: 'aibibu.auth.oauth.retry'
}

export interface ParsedAuthRequest {
  error?: string
  request: AuthRequest
}

function socialProvider(value: string | undefined): AuthSocialProvider | undefined {
  if (value === 'google' || value === 'custom:linuxdo') return value
  return undefined
}

function parseStoredRequest(raw: string | null): AuthRequest | undefined {
  if (!raw) return undefined

  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return undefined
    const candidate = value as Record<string, unknown>
    const storedProvider =
      typeof candidate.provider === 'string'
        ? socialProvider(candidate.provider)
        : undefined
    return {
      clientId:
        typeof candidate.clientId === 'string' ? candidate.clientId : undefined,
      redirectUri:
        typeof candidate.redirectUri === 'string'
          ? candidate.redirectUri
          : undefined,
      state: typeof candidate.state === 'string' ? candidate.state : undefined,
      flow: candidate.flow === 'social' ? 'social' : undefined,
      provider: storedProvider,
      channelState:
        typeof candidate.channelState === 'string'
          ? candidate.channelState
          : undefined,
    }
  } catch {
    return undefined
  }
}

export function allowedRedirectOrigins(): Set<string> {
  return new Set(
    __AUTH_ALLOWED_REDIRECT_ORIGINS__
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

export function createAuthRequestState(
  cryptoProvider: Crypto = crypto
): string {
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

export function buildSocialAuthUrl(
  authOrigin: string,
  provider: AuthSocialProvider,
  channelState: string
): string {
  const url = new URL('/', authOrigin)
  url.searchParams.set('flow', 'social')
  url.searchParams.set('provider', provider)
  url.searchParams.set('channel_state', channelState)
  return url.toString()
}

export function parseAuthRequest(
  search: string,
  allowedOrigins: ReadonlySet<string>,
  storedRaw?: string | null
): ParsedAuthRequest {
  const params = new URLSearchParams(search)
  const stored = parseStoredRequest(storedRaw ?? null)
  const requestedProvider = params.get('provider')?.trim()
  const request: AuthRequest = {
    clientId: params.get('client_id')?.trim() || stored?.clientId,
    redirectUri: params.get('redirect_uri')?.trim() || stored?.redirectUri,
    state: params.get('state')?.trim() || stored?.state,
    flow:
      params.get('flow') === 'social' || stored?.flow === 'social'
        ? 'social'
        : undefined,
    provider: socialProvider(requestedProvider || stored?.provider),
    channelState:
      params.get('channel_state')?.trim() || stored?.channelState,
  }

  if (request.flow === 'social') {
    if (!request.provider) {
      return { request, error: '第三方登录方式无效。' }
    }
    if (!request.channelState) {
      return { request, error: '第三方登录状态无效。' }
    }
    return { request }
  }

  if (!request.redirectUri) return { request }
  if (!request.state) return { request, error: '登录状态无效。' }

  let redirect: URL
  try {
    redirect = new URL(request.redirectUri)
  } catch {
    return { request, error: '回调地址格式无效。' }
  }

  if (!['http:', 'https:'].includes(redirect.protocol)) {
    return { request, error: '回调地址必须使用 HTTP 或 HTTPS。' }
  }
  if (!allowedOrigins.has(redirect.origin)) {
    return { request, error: '此应用尚未获得 Aibibu 登录授权。' }
  }

  return { request }
}

export function persistAuthRequest(request: AuthRequest, storage: Storage): void {
  storage.setItem(AUTH_REQUEST_STORAGE_KEY, JSON.stringify(request))
}

export function clearAuthRequest(storage: Storage): void {
  storage.removeItem(AUTH_REQUEST_STORAGE_KEY)
}

export function createSuccessMessage(
  request: AuthRequest,
  result: AuthResult
): AuthSuccessMessage {
  return {
    type: 'aibibu.auth.success',
    access_token: result.accessToken,
    expires_at: result.expiresAt,
    state: request.state,
  }
}

export function deliverAuthResult(
  request: AuthRequest,
  result: AuthResult,
  receiver: Pick<Window, 'postMessage'> | null
): boolean {
  if (!request.redirectUri || !receiver) return false
  const targetOrigin = new URL(request.redirectUri).origin
  receiver.postMessage(createSuccessMessage(request, result), targetOrigin)
  return true
}

export function deliverSocialAuthResult(
  request: AuthRequest,
  result: AuthResult,
  opener: Pick<Window, 'postMessage'> | null,
  authOrigin: string
): boolean {
  if (!request.channelState || !opener) return false
  const message: SocialAuthSuccessMessage = {
    type: 'aibibu.auth.social.success',
    access_token: result.accessToken,
    expires_at: result.expiresAt,
    state: request.channelState,
  }
  opener.postMessage(message, authOrigin)
  return true
}

export function deliverSocialAuthError(
  request: AuthRequest,
  error: string,
  opener: Pick<Window, 'postMessage'> | null,
  authOrigin: string
): boolean {
  if (!request.channelState || !opener) return false
  const message: SocialAuthErrorMessage = {
    type: 'aibibu.auth.social.error',
    error,
    state: request.channelState,
  }
  opener.postMessage(message, authOrigin)
  return true
}

export function requestOAuthRestart(
  receiver: Pick<Window, 'postMessage'> | null
): boolean {
  if (!receiver) return false
  const message: OAuthRestartMessage = { type: 'aibibu.auth.oauth.retry' }
  // No credentials are sent; the embedding app validates both source and origin.
  receiver.postMessage(message, '*')
  return true
}

export function isSocialAuthSuccessMessage(
  value: unknown,
  expectedState: string
): value is SocialAuthSuccessMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    message.type === 'aibibu.auth.social.success' &&
    typeof message.access_token === 'string' &&
    message.access_token.trim() !== '' &&
    message.state === expectedState
  )
}

export function isSocialAuthErrorMessage(
  value: unknown,
  expectedState: string
): value is SocialAuthErrorMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    message.type === 'aibibu.auth.social.error' &&
    typeof message.error === 'string' &&
    message.error.trim() !== '' &&
    message.state === expectedState
  )
}
