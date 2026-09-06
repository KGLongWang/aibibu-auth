export type AuthMethod = 'password' | 'otp'

export async function lookupAuthMethod(email: string): Promise<AuthMethod> {
  const response = await fetch('/v1/auth/method', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    credentials: 'omit',
  })
  if (!response.ok) throw new Error('登录方式查询失败。')

  const body = (await response.json()) as { method?: unknown }
  if (body.method !== 'password' && body.method !== 'otp') {
    throw new Error('登录服务返回了无效结果。')
  }
  return body.method
}
