import { createClient, type Provider, type Session } from "@supabase/supabase-js";

import type { AuthResult } from "./auth-request";

export type SocialProvider = "google" | "custom:linuxdo";

export interface CurrentAuthSession {
  authResult: AuthResult;
  email: string;
}

export interface AccountIdentity {
  id: string;
  provider: string;
}

export interface AccountMfaFactor {
  id: string;
  friendlyName: string;
  status: string;
}

export interface CentralAccount {
  id: string;
  email: string;
  emailConfirmedAt: string;
  createdAt: string;
  lastSignInAt: string;
  identities: AccountIdentity[];
  factors: AccountMfaFactor[];
  currentAal: string | null;
}

export interface TotpEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export interface OAuthAuthorizationDetails {
  authorizationId: string;
  client: {
    name: string;
    uri: string;
    logoUri: string;
  };
  email: string;
  scopes: string[];
}

export type OAuthAuthorizationResult =
  | { kind: "consent"; details: OAuthAuthorizationDetails }
  | { kind: "redirect"; redirectUrl: string };

let client: ReturnType<typeof createClient> | undefined;

function authClient(): ReturnType<typeof createClient> {
  if (!__SUPABASE_URL__ || !__SUPABASE_PUBLISHABLE_KEY__) {
    throw new Error("Aibibu Auth 尚未配置 Supabase。");
  }
  client ??= createClient(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__, {
    auth: {
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
    },
  });
  return client;
}

function toAuthResult(session: Session): AuthResult {
  return {
    accessToken: session.access_token,
    expiresAt: session.expires_at,
  };
}

function toCurrentAuthSession(session: Session): CurrentAuthSession {
  return {
    authResult: toAuthResult(session),
    email: session.user.email ?? "",
  };
}

export async function currentAuthSession(): Promise<CurrentAuthSession | null> {
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) {
    const { data, error } = await authClient().auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session ? toCurrentAuthSession(data.session) : null;
  }

  const { data, error } = await authClient().auth.getSession();
  if (error) throw error;
  return data.session ? toCurrentAuthSession(data.session) : null;
}

export async function signOutCurrentSession(): Promise<void> {
  const { error } = await authClient().auth.signOut({ scope: "local" });
  if (error) throw error;
}

export async function signOutOtherSessions(): Promise<void> {
  const { error } = await authClient().auth.signOut({ scope: "others" });
  if (error) throw error;
}

export async function loadCentralAccount(): Promise<CentralAccount | null> {
  const session = await currentAuthSession();
  if (!session) return null;

  const [userResponse, identityResponse, factorResponse, aalResponse] = await Promise.all([
    authClient().auth.getUser(),
    authClient().auth.getUserIdentities(),
    authClient().auth.mfa.listFactors(),
    authClient().auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (userResponse.error) throw userResponse.error;
  if (identityResponse.error) throw identityResponse.error;
  if (factorResponse.error) throw factorResponse.error;
  if (aalResponse.error) throw aalResponse.error;

  return {
    id: userResponse.data.user.id,
    email: userResponse.data.user.email ?? "",
    emailConfirmedAt: userResponse.data.user.email_confirmed_at ?? "",
    createdAt: userResponse.data.user.created_at,
    lastSignInAt: userResponse.data.user.last_sign_in_at ?? "",
    identities: identityResponse.data.identities.map((identity) => ({
      id: identity.identity_id,
      provider: identity.provider,
    })),
    factors: factorResponse.data.totp.map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name || "身份验证器",
      status: factor.status,
    })),
    currentAal: aalResponse.data.currentLevel,
  };
}

export async function updateAccountEmail(email: string): Promise<void> {
  const { error } = await authClient().auth.updateUser({ email });
  if (error) throw error;
}

export async function requestPasswordReauthentication(): Promise<void> {
  const { error } = await authClient().auth.reauthenticate();
  if (error) throw error;
}

export async function updateAccountPassword(password: string, nonce: string): Promise<void> {
  const { error } = await authClient().auth.updateUser({ password, nonce });
  if (error) throw error;
}

export async function linkAccountIdentity(
  provider: SocialProvider,
  redirectTo: string,
): Promise<void> {
  const { data, error } = await authClient().auth.linkIdentity({
    provider: provider as Provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Supabase 没有返回账号连接地址。");
  window.location.assign(data.url);
}

export async function beginTotpEnrollment(): Promise<TotpEnrollment> {
  const { data, error } = await authClient().auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Aibibu Authenticator",
    issuer: "Aibibu",
  });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function cancelTotpEnrollment(factorId: string): Promise<void> {
  const { error } = await authClient().auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export async function verifyTotpEnrollment(factorId: string, code: string): Promise<void> {
  const { error } = await authClient().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}

export async function removeTotpFactor(factorId: string, code: string): Promise<void> {
  const verification = await authClient().auth.mfa.challengeAndVerify({ factorId, code });
  if (verification.error) throw verification.error;
  const removal = await authClient().auth.mfa.unenroll({ factorId });
  if (removal.error) throw removal.error;
  const refresh = await authClient().auth.refreshSession();
  if (refresh.error) throw refresh.error;
}

export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await authClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string): Promise<AuthResult> {
  const { data, error } = await authClient().auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw error;
  if (!data.session) throw new Error("Supabase 没有返回登录会话。");
  return toAuthResult(data.session);
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await authClient().auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) throw new Error("邮箱或密码错误。");
  return toAuthResult(data.session);
}

export async function startSocialLogin(
  provider: SocialProvider,
  redirectTo: string,
): Promise<void> {
  const { error } = await authClient().auth.signInWithOAuth({
    provider: provider as Provider,
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function getOAuthAuthorization(
  authorizationId: string,
): Promise<OAuthAuthorizationResult> {
  const { data, error } = await authClient().auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) throw error;
  if ("redirect_url" in data) {
    return { kind: "redirect", redirectUrl: data.redirect_url };
  }
  return {
    kind: "consent",
    details: {
      authorizationId: data.authorization_id,
      client: {
        name: data.client.name,
        uri: data.client.uri,
        logoUri: data.client.logo_uri,
      },
      email: data.user.email,
      scopes: data.scope.split(" ").filter(Boolean),
    },
  };
}

export async function approveOAuthAuthorization(authorizationId: string): Promise<string> {
  const { data, error } = await authClient().auth.oauth.approveAuthorization(authorizationId, {
    skipBrowserRedirect: true,
  });
  if (error) throw error;
  return data.redirect_url;
}

export async function denyOAuthAuthorization(authorizationId: string): Promise<string> {
  const { data, error } = await authClient().auth.oauth.denyAuthorization(authorizationId, {
    skipBrowserRedirect: true,
  });
  if (error) throw error;
  return data.redirect_url;
}
