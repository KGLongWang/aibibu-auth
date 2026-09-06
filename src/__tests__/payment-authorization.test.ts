import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  confirmLagoPaymentAuthorization,
  PaymentAuthorizationApiError,
  requestLagoPaymentAuthorization,
} from '../payment-authorization'

describe('payment authorization API', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('requests an email code with the current Supabase access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authorization_id: 'auth-1',
          masked_email: 'al***@example.test',
          expires_at: '2026-08-31T03:05:00Z',
          resend_after_seconds: 60,
        }),
        { status: 201 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const intent = await requestLagoPaymentAuthorization(
      'supabase-access-token',
      {
        sourceObjectId: 'checkout-1',
        sourceObjectType: 'Checkout',
        amount: '75.00',
        currency: 'CNY',
      },
      'https://api.aibibu.test/'
    )

    expect(intent.authorizationId).toBe('auth-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.aibibu.test/v1/payments/lago/authorizations',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer supabase-access-token',
        }),
      })
    )
  })

  test('returns the one-time token after confirming the six-digit code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            authorization_id: 'auth-1',
            payment_token: 'one-time-payment-token',
            expires_at: '2026-08-31T03:05:00Z',
          }),
          { status: 200 }
        )
      )
    )

    const result = await confirmLagoPaymentAuthorization(
      'supabase-access-token',
      'auth-1',
      '123456'
    )

    expect(result.paymentToken).toBe('one-time-payment-token')
  })

  test('preserves structured API errors for the checkout modal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: { code: 'invalid_otp', message: '邮箱验证码无效或已过期。' },
          }),
          { status: 401 }
        )
      )
    )

    await expect(
      confirmLagoPaymentAuthorization('supabase-access-token', 'auth-1', '000000')
    ).rejects.toEqual(
      expect.objectContaining<Partial<PaymentAuthorizationApiError>>({
        status: 401,
        code: 'invalid_otp',
      })
    )
  })
})
