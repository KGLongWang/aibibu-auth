import { describe, expect, test, vi } from 'vitest'

import {
  buildSocialAuthUrl,
  createSuccessMessage,
  deliverAuthResult,
  deliverSocialAuthResult,
  isSocialAuthSuccessMessage,
  parseAuthRequest,
  resolveLogoutDestination,
} from '../auth-request'

const allowed = new Set(['https://newapi.aibibu.com', 'http://127.0.0.1:5173'])

describe('central auth request', () => {
  test('accepts an approved client callback and preserves state', () => {
    const parsed = parseAuthRequest(
      '?client_id=new-api&redirect_uri=https%3A%2F%2Fnewapi.aibibu.com%2Fauth%2Fcallback&state=random-state',
      allowed
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.request).toEqual({
      clientId: 'new-api',
      redirectUri: 'https://newapi.aibibu.com/auth/callback',
      state: 'random-state',
    })
  })

  test('rejects an unapproved callback origin', () => {
    const parsed = parseAuthRequest(
      '?redirect_uri=https%3A%2F%2Fevil.example%2Fsteal&state=random-state',
      allowed
    )

    expect(parsed.error).toBe('此应用尚未获得 Aibibu 登录授权。')
  })

  test('allows logout to return only to an approved app origin', () => {
    expect(
      resolveLogoutDestination(
        'https://newapi.aibibu.com/signed-out?from=shop',
        'https://auth.aibibu.com',
        allowed
      )
    ).toBe('https://newapi.aibibu.com/signed-out?from=shop')
    expect(
      resolveLogoutDestination(
        'https://evil.example/steal',
        'https://auth.aibibu.com',
        allowed
      )
    ).toBe('/')
    expect(
      resolveLogoutDestination(
        '/signed-out',
        'https://auth.aibibu.com',
        allowed
      )
    ).toBe('/signed-out')
  })

  test('restores the request after an OAuth round trip', () => {
    const parsed = parseAuthRequest(
      '?code=supabase-code',
      allowed,
      JSON.stringify({
        clientId: 'new-api',
        redirectUri: 'http://127.0.0.1:5173/sign-in',
        state: 'saved-state',
      })
    )

    expect(parsed.request.redirectUri).toBe('http://127.0.0.1:5173/sign-in')
    expect(parsed.request.state).toBe('saved-state')
  })

  test('builds a top-level social flow with its own random state', () => {
    const socialUrl = new URL(
      buildSocialAuthUrl(
        'https://auth.aibibu.com',
        'custom:linuxdo',
        'social-state'
      )
    )

    expect(socialUrl.searchParams.get('flow')).toBe('social')
    expect(socialUrl.searchParams.get('provider')).toBe('custom:linuxdo')
    expect(socialUrl.searchParams.get('channel_state')).toBe('social-state')
    expect(socialUrl.searchParams.has('redirect_uri')).toBe(false)
  })

  test('returns only the short-lived access token to the exact opener origin', () => {
    const postMessage = vi.fn()
    const request = {
      redirectUri: 'https://newapi.aibibu.com/auth/callback',
      state: 'expected-state',
    }
    const result = { accessToken: 'access-token', expiresAt: 1_900_000_000 }

    expect(deliverAuthResult(request, result, { postMessage })).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(
      createSuccessMessage(request, result),
      'https://newapi.aibibu.com'
    )
    expect(postMessage.mock.calls[0]?.[0]).not.toHaveProperty('refresh_token')
  })

  test('returns a social result only to the auth origin with matching state', () => {
    const postMessage = vi.fn()
    const request = {
      flow: 'social' as const,
      provider: 'google' as const,
      channelState: 'social-state',
    }
    const result = { accessToken: 'access-token', expiresAt: 1_900_000_000 }

    expect(
      deliverSocialAuthResult(
        request,
        result,
        { postMessage },
        'https://auth.aibibu.com'
      )
    ).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'aibibu.auth.social.success',
        access_token: 'access-token',
        expires_at: 1_900_000_000,
        state: 'social-state',
      },
      'https://auth.aibibu.com'
    )
    expect(
      isSocialAuthSuccessMessage(
        postMessage.mock.calls[0]?.[0],
        'social-state'
      )
    ).toBe(true)
    expect(
      isSocialAuthSuccessMessage(
        postMessage.mock.calls[0]?.[0],
        'different-state'
      )
    ).toBe(false)
  })
})
