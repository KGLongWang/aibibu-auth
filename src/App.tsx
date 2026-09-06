import { useEffect, useMemo, useRef, useState } from "react";
import { FcGoogle } from "react-icons/fc";

import {
  AUTH_REQUEST_STORAGE_KEY,
  allowedRedirectOrigins,
  buildSocialAuthUrl,
  clearAuthRequest,
  createAuthRequestState,
  deliverAuthResult,
  deliverSocialAuthError,
  deliverSocialAuthResult,
  isSocialAuthErrorMessage,
  isSocialAuthSuccessMessage,
  parseAuthRequest,
  persistAuthRequest,
  requestOAuthRestart,
  type AuthResult,
} from "./auth-request";
import { lookupAuthMethod } from "./auth-method";
import {
  approveOAuthAuthorization,
  currentAuthSession,
  denyOAuthAuthorization,
  getOAuthAuthorization,
  sendEmailCode,
  signInWithPassword,
  signOutCurrentSession,
  startSocialLogin,
  verifyEmailCode,
  type CurrentAuthSession,
  type OAuthAuthorizationDetails,
  type SocialProvider,
} from "./supabase-auth";

type Mode =
  | "entry"
  | "account"
  | "password"
  | "otp"
  | "consent"
  | "reconnecting"
  | "complete";

interface SocialAttempt {
  popup: Window;
  state: string;
  closePoll: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOCIAL_POPUP_WIDTH = 520;
const SOCIAL_POPUP_HEIGHT = 720;

function isExpiredOAuthAuthorization(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const error = reason as { code?: unknown; message?: unknown };
  if (error.code === "oauth_authorization_not_found") return true;
  return (
    typeof error.message === "string" &&
    /authorization (?:not found|request is not pending)/i.test(error.message)
  );
}

function localReturnPath(search: string): string {
  const value = new URLSearchParams(search).get("return_to")?.trim();
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/")) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function LinuxDoMark() {
  return (
    <span className="linuxdo-mark" aria-hidden="true">
      <span className="linuxdo-band linuxdo-band-dark" />
      <span className="linuxdo-band linuxdo-band-light" />
      <span className="linuxdo-band linuxdo-band-gold" />
    </span>
  );
}

function socialPopupFeatures(): string {
  const left = Math.max(0, Math.round((window.screen.availWidth - SOCIAL_POPUP_WIDTH) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - SOCIAL_POPUP_HEIGHT) / 2));
  return [
    "popup=yes",
    `width=${SOCIAL_POPUP_WIDTH}`,
    `height=${SOCIAL_POPUP_HEIGHT}`,
    `left=${left}`,
    `top=${top}`,
  ].join(",");
}

export function App() {
  const parsedRequest = useMemo(
    () =>
      parseAuthRequest(
        window.location.search,
        allowedRedirectOrigins(),
        sessionStorage.getItem(AUTH_REQUEST_STORAGE_KEY),
      ),
    [],
  );
  const embedded = window.parent !== window;
  const returnTo = useMemo(() => localReturnPath(window.location.search), []);
  const socialFlow = parsedRequest.request.flow === "social";
  const authorizationPage = window.location.pathname === "/authorize";
  const authorizationId = authorizationPage
    ? new URLSearchParams(window.location.search).get("authorization_id")?.trim() || ""
    : "";
  const [mode, setMode] = useState<Mode>("entry");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [busy, setBusy] = useState(socialFlow);
  const [error, setError] = useState(
    parsedRequest.error || (authorizationPage && !authorizationId ? "授权请求无效。" : ""),
  );
  const [authorizationDetails, setAuthorizationDetails] =
    useState<OAuthAuthorizationDetails | null>(null);
  const [currentSession, setCurrentSession] = useState<CurrentAuthSession | null>(null);
  const completionStarted = useRef(false);
  const authStateRead = useRef(false);
  const socialAttempt = useRef<SocialAttempt | null>(null);
  const otpInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  async function loadAuthorization() {
    if (!authorizationId) return;
    setBusy(true);
    setError("");
    try {
      const result = await getOAuthAuthorization(authorizationId);
      if (result.kind === "redirect") {
        window.location.assign(result.redirectUrl);
        return;
      }
      setAuthorizationDetails(result.details);
      setMode("consent");
    } catch (reason: unknown) {
      completionStarted.current = false;
      if (isExpiredOAuthAuthorization(reason)) {
        setAuthorizationDetails(null);
        setMode("reconnecting");
        setError("");
        requestOAuthRestart(window.parent);
        return;
      }
      setError(reason instanceof Error ? reason.message : "授权请求读取失败。");
    } finally {
      setBusy(false);
    }
  }

  function complete(result: AuthResult) {
    if (completionStarted.current) return;
    completionStarted.current = true;

    if (authorizationPage) {
      void loadAuthorization();
      return;
    }

    if (!socialFlow && !parsedRequest.request.redirectUri) {
      clearAuthRequest(sessionStorage);
      setMode("complete");
      window.setTimeout(() => window.location.assign(returnTo || "/account"), 250);
      return;
    }

    let delivered = false;
    if (socialFlow) {
      delivered = deliverSocialAuthResult(
        parsedRequest.request,
        result,
        window.opener,
        window.location.origin,
      );
    } else {
      const receiver = embedded ? window.parent : window.opener;
      delivered = deliverAuthResult(parsedRequest.request, result, receiver);
    }

    clearAuthRequest(sessionStorage);
    setMode("complete");
    if (socialFlow && delivered) {
      window.setTimeout(() => window.close(), 150);
    }
  }

  useEffect(() => {
    if (authStateRead.current) return;
    authStateRead.current = true;

    if (parsedRequest.error) {
      if (socialFlow) {
        deliverSocialAuthError(
          parsedRequest.request,
          parsedRequest.error,
          window.opener,
          window.location.origin,
        );
      }
      setBusy(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error_description") || params.get("error");
    if (oauthError) {
      if (socialFlow) {
        deliverSocialAuthError(
          parsedRequest.request,
          oauthError,
          window.opener,
          window.location.origin,
        );
        clearAuthRequest(sessionStorage);
        setMode("complete");
        window.setTimeout(() => window.close(), 150);
      } else {
        setError(oauthError);
        window.history.replaceState({}, "", "/");
      }
      setBusy(false);
      return;
    }

    if (socialFlow && !params.get("code")) {
      persistAuthRequest(parsedRequest.request, sessionStorage);
      void startSocialLogin(
        parsedRequest.request.provider as SocialProvider,
        `${window.location.origin}/callback`,
      ).catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : "无法开始第三方登录。";
        deliverSocialAuthError(
          parsedRequest.request,
          message,
          window.opener,
          window.location.origin,
        );
        setError(message);
        setBusy(false);
      });
      return;
    }

    void currentAuthSession()
      .then((session) => {
        if (!session) return;
        if (authorizationPage) {
          setCurrentSession(session);
          setMode("account");
          setBusy(false);
          return;
        }
        if (socialFlow || parsedRequest.request.redirectUri || returnTo) {
          complete(session.authResult);
        }
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : "登录状态读取失败。";
        if (socialFlow) {
          deliverSocialAuthError(
            parsedRequest.request,
            message,
            window.opener,
            window.location.origin,
          );
        }
        setError(message);
        setBusy(false);
      });
  }, [authorizationPage, parsedRequest.error, parsedRequest.request, returnTo, socialFlow]);

  useEffect(() => {
    if (socialFlow) return;

    const handleSocialMessage = (event: MessageEvent<unknown>) => {
      const attempt = socialAttempt.current;
      if (!attempt || event.origin !== window.location.origin || event.source !== attempt.popup) {
        return;
      }

      if (isSocialAuthSuccessMessage(event.data, attempt.state)) {
        window.clearInterval(attempt.closePoll);
        socialAttempt.current = null;
        if (!attempt.popup.closed) attempt.popup.close();
        setBusy(false);
        complete({
          accessToken: event.data.access_token,
          expiresAt: event.data.expires_at,
        });
        return;
      }

      if (isSocialAuthErrorMessage(event.data, attempt.state)) {
        window.clearInterval(attempt.closePoll);
        socialAttempt.current = null;
        if (!attempt.popup.closed) attempt.popup.close();
        setBusy(false);
        setError(event.data.error);
      }
    };

    window.addEventListener("message", handleSocialMessage);
    return () => window.removeEventListener("message", handleSocialMessage);
  }, [socialFlow]);

  useEffect(
    () => () => {
      const attempt = socialAttempt.current;
      if (!attempt) return;
      window.clearInterval(attempt.closePoll);
      if (!attempt.popup.closed) attempt.popup.close();
    },
    [],
  );

  useEffect(() => {
    if (mode === "otp") otpInput.current?.focus();
    if (mode === "password") passwordInput.current?.focus();
  }, [mode]);

  function handleSocialLogin(provider: SocialProvider) {
    if (parsedRequest.error || socialAttempt.current) return;

    setBusy(true);
    setError("");
    const channelState = createAuthRequestState();
    const popup = window.open(
      buildSocialAuthUrl(window.location.origin, provider, channelState),
      "aibibu-social-auth",
      socialPopupFeatures(),
    );
    if (!popup) {
      setError("登录窗口被浏览器拦截，请允许弹窗后重试。");
      setBusy(false);
      return;
    }

    const closePoll = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(closePoll);
      if (socialAttempt.current?.popup === popup) {
        socialAttempt.current = null;
        setBusy(false);
      }
    }, 250);
    socialAttempt.current = { popup, state: channelState, closePoll };
    popup.focus();
  }

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsedRequest.error) return;
    setError("");

    if (mode === "entry") {
      const normalizedEmail = email.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setError("请输入有效的邮箱地址。");
        return;
      }
      setBusy(true);
      try {
        setPendingEmail(normalizedEmail);
        let preferredMethod: "password" | "otp" = "otp";
        try {
          preferredMethod = await lookupAuthMethod(normalizedEmail);
        } catch {
          // Supabase OTP remains a usable fallback if Aibibu Server is unavailable.
        }
        if (preferredMethod === "password") {
          setMode("password");
        } else {
          await sendEmailCode(normalizedEmail);
          setMode("otp");
        }
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : "验证码发送失败。");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "password") {
      if (!password) {
        setError("请输入密码。");
        return;
      }
      setBusy(true);
      try {
        complete(await signInWithPassword(pendingEmail, password));
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : "邮箱或密码错误。");
        setBusy(false);
      }
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      setError("请输入 6 位验证码。");
      return;
    }
    setBusy(true);
    try {
      complete(await verifyEmailCode(pendingEmail, otp));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "验证码验证失败。");
      setBusy(false);
    }
  }

  async function handleUseEmailCode() {
    setError("");
    setBusy(true);
    try {
      await sendEmailCode(pendingEmail);
      setOtp("");
      setMode("otp");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "验证码发送失败。");
    } finally {
      setBusy(false);
    }
  }

  function returnToEntry() {
    setMode("entry");
    setPassword("");
    setOtp("");
    setError("");
  }

  function continueWithCurrentAccount() {
    if (!currentSession || busy) return;
    complete(currentSession.authResult);
  }

  async function useAnotherAccount() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await signOutCurrentSession();
      setCurrentSession(null);
      setMode("entry");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "无法切换账号。");
    } finally {
      setBusy(false);
    }
  }

  async function handleAuthorizationDecision(approved: boolean) {
    if (!authorizationDetails || busy) return;
    setBusy(true);
    setError("");
    try {
      const redirectUrl = approved
        ? await approveOAuthAuthorization(authorizationDetails.authorizationId)
        : await denyOAuthAuthorization(authorizationDetails.authorizationId);
      window.location.assign(redirectUrl);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "授权操作失败。");
      setBusy(false);
    }
  }

  if (socialFlow) {
    return (
      <main className="auth-shell social-auth-shell">
        <section className="auth-card auth-card-complete" aria-labelledby="social-title">
          {mode === "complete" ? (
            <div className="success-mark" aria-hidden="true">
              ✓
            </div>
          ) : (
            <span className="social-spinner" aria-hidden="true" />
          )}
          <h1 id="social-title">{mode === "complete" ? "登录完成" : "正在连接账户"}</h1>
          <p>{error || (mode === "complete" ? "正在返回登录页面。" : "请在此窗口中完成登录。")}</p>
        </section>
      </main>
    );
  }

  if (mode === "complete") {
    return (
      <main className={`auth-shell${embedded ? " auth-shell-embedded" : ""}`}>
        <section className="auth-card auth-card-complete" aria-labelledby="complete-title">
          <div className="success-mark" aria-hidden="true">
            ✓
          </div>
          <h1 id="complete-title">登录成功</h1>
          <p>正在返回应用。</p>
        </section>
      </main>
    );
  }

  if (mode === "reconnecting") {
    return (
      <main className={`auth-shell${embedded ? " auth-shell-embedded" : ""}`}>
        <section className="auth-card auth-card-complete" aria-labelledby="reconnecting-title">
          <span className="social-spinner" aria-hidden="true" />
          <h1 id="reconnecting-title">正在重新连接</h1>
          <p>登录会话已过期，正在重新开始。</p>
        </section>
      </main>
    );
  }

  if (mode === "consent" && authorizationDetails) {
    return (
      <main className={`auth-shell${embedded ? " auth-shell-embedded" : ""}`}>
        <section className="auth-card" aria-labelledby="consent-title">
          <div className="brand" aria-label="Aibibu">
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            <span>Aibibu</span>
          </div>
          <header className="auth-header">
            <h1 id="consent-title">授权 {authorizationDetails.client.name}</h1>
            <p>以 {authorizationDetails.email} 继续</p>
          </header>
          <div className="consent-details">
            <p>此应用将获得：</p>
            <ul>
              {authorizationDetails.scopes.map((scope) => (
                <li key={scope}>
                  {scope === "openid"
                    ? "确认你的身份"
                    : scope === "email"
                      ? "读取你的邮箱地址"
                      : scope === "profile"
                        ? "读取你的基础资料"
                        : scope}
                </li>
              ))}
            </ul>
          </div>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="continue-button consent-button"
            type="button"
            disabled={busy}
            onClick={() => void handleAuthorizationDecision(true)}
          >
            {busy ? <span className="button-spinner" aria-hidden="true" /> : null}
            允许并继续
          </button>
          <button
            className="alternate-button"
            type="button"
            disabled={busy}
            onClick={() => void handleAuthorizationDecision(false)}
          >
            取消
          </button>
        </section>
      </main>
    );
  }

  if (mode === "account" && currentSession) {
    const accountLabel = currentSession.email || "当前账号";
    return (
      <main className={`auth-shell${embedded ? " auth-shell-embedded" : ""}`}>
        <section className="auth-card" aria-labelledby="account-title">
          <div className="brand" aria-label="Aibibu">
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            <span>Aibibu</span>
          </div>
          <header className="auth-header">
            <h1 id="account-title">选择账号</h1>
            <p>使用已登录的 Aibibu 账号继续。</p>
          </header>
          {error ? (
            <p className="error-message account-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="continue-button account-button"
            type="button"
            disabled={busy}
            onClick={continueWithCurrentAccount}
          >
            {busy ? <span className="button-spinner" aria-hidden="true" /> : null}
            以 {accountLabel} 继续
          </button>
          <button
            className="alternate-button"
            type="button"
            disabled={busy}
            onClick={() => void useAnotherAccount()}
          >
            使用其他账号
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={`auth-shell${embedded ? " auth-shell-embedded" : ""}`}>
      <section className="auth-card" aria-labelledby="auth-title">
        {!embedded ? (
          <button
            className="close-button"
            type="button"
            aria-label="关闭"
            onClick={() => window.close()}
          >
            ×
          </button>
        ) : null}

        <div className="brand" aria-label="Aibibu">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>Aibibu</span>
        </div>

        <header className="auth-header">
          <h1 id="auth-title">
            {mode === "password" ? "输入密码" : mode === "otp" ? "验证你的邮箱" : "登录或创建账户"}
          </h1>
          <p>
            {mode === "password"
              ? `使用 ${pendingEmail} 继续`
              : mode === "otp"
                ? `验证码已发送至 ${pendingEmail}`
                : "使用你的账号继续。"}
          </p>
        </header>

        {mode === "entry" ? (
          <div className="social-list">
            <button
              className="provider-button"
              type="button"
              disabled={busy || Boolean(parsedRequest.error)}
              onClick={() => handleSocialLogin("custom:linuxdo")}
            >
              <LinuxDoMark />
              <span>使用 LinuxDO 继续</span>
            </button>
            <button
              className="provider-button"
              type="button"
              disabled={busy || Boolean(parsedRequest.error)}
              onClick={() => handleSocialLogin("google")}
            >
              <FcGoogle className="provider-icon" aria-hidden="true" />
              <span>使用 Google 继续</span>
            </button>
          </div>
        ) : null}

        {mode === "entry" ? (
          <div className="separator">
            <span>或继续使用</span>
          </div>
        ) : null}

        <form className="email-form" onSubmit={(event) => void handleEmailSubmit(event)}>
          {mode === "entry" ? (
            <label>
              <span>邮箱地址</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          ) : mode === "password" ? (
            <label>
              <span>密码</span>
              <input
                ref={passwordInput}
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          ) : (
            <label>
              <span>6 位验证码</span>
              <input
                ref={otpInput}
                className="otp-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                disabled={busy}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
              />
            </label>
          )}

          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="continue-button"
            type="submit"
            disabled={busy || Boolean(parsedRequest.error)}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {mode === "password" ? "登录" : mode === "otp" ? "验证并继续" : "继续"}
          </button>
        </form>

        {mode === "password" ? (
          <button
            className="alternate-button"
            type="button"
            disabled={busy}
            onClick={() => void handleUseEmailCode()}
          >
            使用邮箱验证码登录
          </button>
        ) : null}

        {mode === "password" || mode === "otp" ? (
          <button className="text-button" type="button" disabled={busy} onClick={returnToEntry}>
            更换邮箱地址
          </button>
        ) : null}

        <p className="legal-copy">继续即表示你同意 Aibibu 的服务条款和隐私政策。</p>
      </section>
    </main>
  );
}
