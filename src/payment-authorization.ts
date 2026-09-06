export type SaleorPaymentSourceType = 'Checkout' | 'Order'

export interface LagoAuthorizationRequest {
  sourceObjectId: string
  sourceObjectType: SaleorPaymentSourceType
  amount: string
  currency: string
}

export interface LagoAuthorizationIntent {
  authorizationId: string
  maskedEmail: string
  expiresAt: string
  resendAfterSeconds: number
}

export interface LagoAuthorizedPayment {
  authorizationId: string
  paymentToken: string
  expiresAt: string
}

export class PaymentAuthorizationApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PaymentAuthorizationApiError'
    this.status = status
    this.code = code
  }
}

export async function requestLagoPaymentAuthorization(
  accessToken: string,
  input: LagoAuthorizationRequest,
  apiBaseUrl = ''
): Promise<LagoAuthorizationIntent> {
  const body = await postPaymentApi(
    apiBaseUrl,
    '/v1/payments/lago/authorizations',
    accessToken,
    {
      source_object_id: input.sourceObjectId,
      source_object_type: input.sourceObjectType,
      amount: input.amount,
      currency: input.currency,
    }
  )
  const authorizationId = stringField(body, 'authorization_id')
  const maskedEmail = stringField(body, 'masked_email')
  const expiresAt = stringField(body, 'expires_at')
  const resendAfterSeconds = numberField(body, 'resend_after_seconds')
  return { authorizationId, maskedEmail, expiresAt, resendAfterSeconds }
}

export async function confirmLagoPaymentAuthorization(
  accessToken: string,
  authorizationId: string,
  code: string,
  apiBaseUrl = ''
): Promise<LagoAuthorizedPayment> {
  const body = await postPaymentApi(
    apiBaseUrl,
    `/v1/payments/lago/authorizations/${encodeURIComponent(authorizationId)}/confirm`,
    accessToken,
    { code }
  )
  return {
    authorizationId: stringField(body, 'authorization_id'),
    paymentToken: stringField(body, 'payment_token'),
    expiresAt: stringField(body, 'expires_at'),
  }
}

async function postPaymentApi(
  apiBaseUrl: string,
  path: string,
  accessToken: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!accessToken.trim()) throw new Error('缺少 Supabase access token。')
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    credentials: 'omit',
  })
  const body = await readJsonObject(response)
  if (!response.ok) {
    const detail = objectField(body, 'detail')
    throw new PaymentAuthorizationApiError(
      response.status,
      optionalStringField(detail, 'code') || 'payment_authorization_failed',
      optionalStringField(detail, 'message') || '支付验证失败。'
    )
  }
  return body
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = (await response.json()) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('支付服务返回了无效结果。')
  }
  return value as Record<string, unknown>
}

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : {}
}

function optionalStringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = optionalStringField(value, key)
  if (!field) throw new Error('支付服务返回了无效结果。')
  return field
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isFinite(field)) {
    throw new Error('支付服务返回了无效结果。')
  }
  return field
}
