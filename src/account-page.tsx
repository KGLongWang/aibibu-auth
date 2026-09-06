import { useEffect, useMemo, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import {
  FiArrowLeft,
  FiCheck,
  FiChevronRight,
  FiKey,
  FiLock,
  FiLogOut,
  FiMail,
  FiMonitor,
  FiShield,
  FiSmartphone,
  FiTerminal,
  FiUser,
} from "react-icons/fi";

import { allowedRedirectOrigins } from "./auth-request";
import {
  beginTotpEnrollment,
  cancelTotpEnrollment,
  linkAccountIdentity,
  loadCentralAccount,
  removeTotpFactor,
  requestPasswordReauthentication,
  signOutCurrentSession,
  signOutOtherSessions,
  updateAccountEmail,
  updateAccountPassword,
  verifyTotpEnrollment,
  type CentralAccount,
  type SocialProvider,
  type TotpEnrollment,
} from "./supabase-auth";

interface Notice {
  tone: "success" | "error";
  message: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function returnUrl(): string {
  const value = new URLSearchParams(window.location.search).get("return_to")?.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (!allowedRedirectOrigins().has(url.origin)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function isEmbeddedAccount(): boolean {
  return new URLSearchParams(window.location.search).get("embedded") === "1";
}

function accountLoginUrl(): string {
  const accountUrl = new URL("/account", window.location.origin);
  const destination = returnUrl();
  if (destination) accountUrl.searchParams.set("return_to", destination);
  if (isEmbeddedAccount()) accountUrl.searchParams.set("embedded", "1");
  const loginUrl = new URL("/", window.location.origin);
  loginUrl.searchParams.set("return_to", `${accountUrl.pathname}${accountUrl.search}`);
  return loginUrl.toString();
}

function formatDate(value: string): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AccountPage() {
  const destination = useMemo(returnUrl, []);
  const embedded = useMemo(isEmbeddedAccount, []);
  const [account, setAccount] = useState<CentralAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [emailEditing, setEmailEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [passwordEditing, setPasswordEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordNonce, setPasswordNonce] = useState("");
  const [passwordNonceSent, setPasswordNonceSent] = useState(false);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [removingFactorId, setRemovingFactorId] = useState("");
  const [removalCode, setRemovalCode] = useState("");

  async function refreshAccount() {
    const result = await loadCentralAccount();
    setAccount(result);
    if (result) setNewEmail(result.email);
  }

  useEffect(() => {
    void refreshAccount()
      .catch((reason: unknown) => {
        setNotice({
          tone: "error",
          message: reason instanceof Error ? reason.message : "账号信息读取失败。",
        });
      })
      .finally(() => {
        setLoading(false);
        const params = new URLSearchParams(window.location.search);
        if (!params.has("code")) return;
        params.delete("code");
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`,
        );
      });
  }, []);

  async function handleEmailUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = newEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setNotice({ tone: "error", message: "请输入有效的邮箱地址。" });
      return;
    }
    setBusyAction("email");
    setNotice(null);
    try {
      await updateAccountEmail(normalizedEmail);
      setEmailEditing(false);
      setNotice({ tone: "success", message: "确认邮件已发送，请完成邮箱验证。" });
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "邮箱更新失败。",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handlePasswordUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setNotice({ tone: "error", message: "密码至少需要 8 个字符。" });
      return;
    }
    if (password !== passwordConfirmation) {
      setNotice({ tone: "error", message: "两次输入的密码不一致。" });
      return;
    }
    if (!passwordNonceSent) {
      setBusyAction("password-reauth");
      setNotice(null);
      try {
        await requestPasswordReauthentication();
        setPasswordNonceSent(true);
        setNotice({
          tone: "success",
          message: `验证码已发送至 ${account?.email || "当前邮箱"}。`,
        });
      } catch (reason: unknown) {
        setNotice({
          tone: "error",
          message: reason instanceof Error ? reason.message : "验证码发送失败。",
        });
      } finally {
        setBusyAction("");
      }
      return;
    }
    if (!/^\d{6}$/.test(passwordNonce)) {
      setNotice({ tone: "error", message: "请输入邮件中的 6 位验证码。" });
      return;
    }
    setBusyAction("password");
    setNotice(null);
    try {
      await updateAccountPassword(password, passwordNonce);
      setPassword("");
      setPasswordConfirmation("");
      setPasswordNonce("");
      setPasswordNonceSent(false);
      setPasswordEditing(false);
      setNotice({ tone: "success", message: "密码已更新。" });
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "密码更新失败。",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handlePasswordCodeResend() {
    setBusyAction("password-reauth");
    setNotice(null);
    try {
      await requestPasswordReauthentication();
      setNotice({
        tone: "success",
        message: `新的验证码已发送至 ${account?.email || "当前邮箱"}。`,
      });
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "验证码发送失败。",
      });
    } finally {
      setBusyAction("");
    }
  }

  function togglePasswordEditing() {
    setPasswordEditing((value) => !value);
    setPassword("");
    setPasswordConfirmation("");
    setPasswordNonce("");
    setPasswordNonceSent(false);
  }

  async function handleIdentityLink(provider: SocialProvider) {
    setBusyAction(`identity:${provider}`);
    setNotice(null);
    try {
      const callbackUrl = new URL("/account", window.location.origin);
      if (destination) callbackUrl.searchParams.set("return_to", destination);
      await linkAccountIdentity(provider, callbackUrl.toString());
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "登录方式连接失败。",
      });
      setBusyAction("");
    }
  }

  async function handleStartEnrollment() {
    setBusyAction("mfa-enroll");
    setNotice(null);
    try {
      setEnrollment(await beginTotpEnrollment());
      setTotpCode("");
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "两步认证设置失败。",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCancelEnrollment() {
    if (!enrollment) return;
    setBusyAction("mfa-cancel");
    try {
      await cancelTotpEnrollment(enrollment.factorId);
      setEnrollment(null);
      setTotpCode("");
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "无法取消两步认证设置。",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handleVerifyEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment || !/^\d{6}$/.test(totpCode)) {
      setNotice({ tone: "error", message: "请输入身份验证器生成的 6 位验证码。" });
      return;
    }
    setBusyAction("mfa-verify");
    setNotice(null);
    try {
      await verifyTotpEnrollment(enrollment.factorId, totpCode);
      setEnrollment(null);
      setTotpCode("");
      await refreshAccount();
      setNotice({ tone: "success", message: "两步认证已启用。" });
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "验证码无效。",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handleRemoveFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!removingFactorId || !/^\d{6}$/.test(removalCode)) {
      setNotice({ tone: "error", message: "请输入身份验证器生成的 6 位验证码。" });
      return;
    }
    setBusyAction("mfa-remove");
    setNotice(null);
    try {
      await removeTotpFactor(removingFactorId, removalCode);
      setRemovingFactorId("");
      setRemovalCode("");
      await refreshAccount();
      setNotice({ tone: "success", message: "两步认证已移除。" });
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "两步认证移除失败。",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handleSignOutOthers() {
    setBusyAction("sessions-others");
    setNotice(null);
    try {
      await signOutOtherSessions();
      setNotice({ tone: "success", message: "其他设备的登录会话已退出。" });
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "其他会话退出失败。",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handleSignOutCurrent() {
    setBusyAction("sessions-current");
    setNotice(null);
    try {
      await signOutCurrentSession();
      window.location.assign(accountLoginUrl());
    } catch (reason: unknown) {
      setNotice({
        tone: "error",
        message: reason instanceof Error ? reason.message : "退出失败。",
      });
      setBusyAction("");
    }
  }

  if (loading) {
    return (
      <main className="account-loading" aria-label="正在加载账号">
        <span className="social-spinner" aria-hidden="true" />
      </main>
    );
  }

  if (!account) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="account-login-title">
          <div className="brand" aria-label="Aibibu">
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            <span>Aibibu</span>
          </div>
          <header className="auth-header">
            <h1 id="account-login-title">登录以管理账号</h1>
            <p>账号安全设置需要先确认你的身份。</p>
          </header>
          {notice ? (
            <p className="error-message" role="alert">
              {notice.message}
            </p>
          ) : null}
          <button
            className="continue-button account-sign-in-button"
            type="button"
            onClick={() => window.location.assign(accountLoginUrl())}
          >
            登录 Aibibu
          </button>
        </section>
      </main>
    );
  }

  const connectedProviders = new Set(account.identities.map((identity) => identity.provider));
  const qrCode = enrollment?.qrCode.startsWith("data:")
    ? enrollment.qrCode
    : `data:image/svg+xml;utf-8,${encodeURIComponent(enrollment?.qrCode ?? "")}`;

  return (
    <main className="account-shell">
      <header className="account-topbar">
        <div className="account-topbar-inner">
          <div className="brand account-brand" aria-label="Aibibu">
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            <span>Aibibu</span>
          </div>
          {destination && !embedded ? (
            <a className="return-link" href={destination} target="_top">
              <FiArrowLeft aria-hidden="true" />
              返回应用
            </a>
          ) : null}
        </div>
      </header>

      <div className={`account-layout${embedded ? " account-layout-embedded" : ""}`}>
        {!embedded ? <aside className="account-navigation" aria-label="账号设置导航">
          <p>账号设置</p>
          <a href="#profile">
            <FiUser aria-hidden="true" />
            账号
          </a>
          <a href="#methods">
            <FiKey aria-hidden="true" />
            登录方式
          </a>
          <a href="#security">
            <FiShield aria-hidden="true" />
            安全
          </a>
          <a href="#sessions">
            <FiMonitor aria-hidden="true" />
            Aibibu Auth 会话
          </a>
        </aside> : null}

        <div className="account-content">
          <header className="account-heading">
            <p>Aibibu 账号</p>
            <h1>账号与安全</h1>
          </header>

          {notice ? (
            <div className={`account-notice account-notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
              {notice.tone === "success" ? <FiCheck aria-hidden="true" /> : null}
              <span>{notice.message}</span>
            </div>
          ) : null}

          <section className="account-section" id="profile" aria-labelledby="profile-title">
            <div className="account-section-heading">
              <div>
                <h2 id="profile-title">账号</h2>
                <p>你的中央身份信息。</p>
              </div>
            </div>
            <div className="account-profile-row">
              <div className="account-avatar" aria-hidden="true">
                {(account.email[0] || "A").toUpperCase()}
              </div>
              <div>
                <strong>{account.email || "未设置邮箱"}</strong>
                <span>创建于 {formatDate(account.createdAt)}</span>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <FiMail aria-hidden="true" />
                <div>
                  <strong>邮箱地址</strong>
                  <span>{account.emailConfirmedAt ? "已验证" : "等待验证"}</span>
                </div>
              </div>
              <button className="secondary-action" type="button" onClick={() => setEmailEditing((value) => !value)}>
                更改
              </button>
            </div>
            {emailEditing ? (
              <form className="inline-account-form" onSubmit={(event) => void handleEmailUpdate(event)}>
                <label htmlFor="new-email">新邮箱地址</label>
                <div className="inline-form-row">
                  <input id="new-email" type="email" autoComplete="email" value={newEmail} disabled={busyAction === "email"} onChange={(event) => setNewEmail(event.target.value)} />
                  <button className="primary-action" type="submit" disabled={busyAction === "email"}>发送确认邮件</button>
                </div>
              </form>
            ) : null}
          </section>

          <section className="account-section" id="methods" aria-labelledby="methods-title">
            <div className="account-section-heading">
              <div>
                <h2 id="methods-title">登录方式</h2>
                <p>用于登录所有 Aibibu 产品。</p>
              </div>
            </div>
            <div className="method-list">
              <div className="method-row">
                <span className="method-icon"><FiMail aria-hidden="true" /></span>
                <div><strong>邮箱</strong><span>密码或邮箱验证码</span></div>
                <span className="status-label"><FiCheck aria-hidden="true" />已连接</span>
              </div>
              <div className="method-row">
                <span className="method-icon"><FcGoogle aria-hidden="true" /></span>
                <div><strong>Google</strong><span>Google 账号</span></div>
                {connectedProviders.has("google") ? (
                  <span className="status-label"><FiCheck aria-hidden="true" />已连接</span>
                ) : (
                  <button className="secondary-action" type="button" disabled={busyAction === "identity:google"} onClick={() => void handleIdentityLink("google")}>连接</button>
                )}
              </div>
              <div className="method-row">
                <span className="method-icon"><FiTerminal aria-hidden="true" /></span>
                <div><strong>LinuxDO</strong><span>LinuxDO 账号</span></div>
                {connectedProviders.has("custom:linuxdo") ? (
                  <span className="status-label"><FiCheck aria-hidden="true" />已连接</span>
                ) : (
                  <button className="secondary-action" type="button" disabled={busyAction === "identity:custom:linuxdo"} onClick={() => void handleIdentityLink("custom:linuxdo")}>连接</button>
                )}
              </div>
            </div>
          </section>

          <section className="account-section" id="security" aria-labelledby="security-title">
            <div className="account-section-heading">
              <div>
                <h2 id="security-title">安全</h2>
                <p>保护中央账号和全部关联产品。</p>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <FiLock aria-hidden="true" />
                <div><strong>密码</strong><span>设置或更新登录密码</span></div>
              </div>
              <button className="secondary-action" type="button" onClick={togglePasswordEditing}>{passwordEditing ? "取消" : "更新"}</button>
            </div>
            {passwordEditing ? (
              <form className="stacked-account-form" onSubmit={(event) => void handlePasswordUpdate(event)}>
                <label htmlFor="new-password">新密码</label>
                <input id="new-password" type="password" autoComplete="new-password" value={password} disabled={busyAction === "password" || busyAction === "password-reauth"} onChange={(event) => setPassword(event.target.value)} />
                <label htmlFor="confirm-password">确认新密码</label>
                <input id="confirm-password" type="password" autoComplete="new-password" value={passwordConfirmation} disabled={busyAction === "password" || busyAction === "password-reauth"} onChange={(event) => setPasswordConfirmation(event.target.value)} />
                {passwordNonceSent ? (
                  <>
                    <label htmlFor="password-nonce">邮箱验证码</label>
                    <input id="password-nonce" className="code-field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={passwordNonce} disabled={busyAction === "password" || busyAction === "password-reauth"} onChange={(event) => setPasswordNonce(event.target.value.replace(/\D/g, ""))} />
                    <button className="text-action password-resend-action" type="button" disabled={busyAction === "password-reauth"} onClick={() => void handlePasswordCodeResend()}>重新发送验证码</button>
                  </>
                ) : null}
                <button className="primary-action" type="submit" disabled={busyAction === "password" || busyAction === "password-reauth"}>{passwordNonceSent ? "确认并保存" : "发送验证码"}</button>
              </form>
            ) : null}

            <div className="setting-row setting-row-divider">
              <div className="setting-copy">
                <FiSmartphone aria-hidden="true" />
                <div><strong>两步认证</strong><span>{account.factors.length ? `已启用 · ${account.currentAal === "aal2" ? "本次会话已验证" : "登录时验证"}` : "未启用"}</span></div>
              </div>
              {!account.factors.length && !enrollment ? (
                <button className="secondary-action" type="button" disabled={busyAction === "mfa-enroll"} onClick={() => void handleStartEnrollment()}>启用</button>
              ) : null}
            </div>
            {account.factors.map((factor) => (
              <div className="factor-row" key={factor.id}>
                <div><strong>{factor.friendlyName}</strong><span>身份验证器</span></div>
                <button className="danger-text-action" type="button" onClick={() => { setRemovingFactorId(factor.id); setRemovalCode(""); }}>移除</button>
              </div>
            ))}
            {removingFactorId ? (
              <form className="inline-account-form" onSubmit={(event) => void handleRemoveFactor(event)}>
                <label htmlFor="remove-totp-code">身份验证器验证码</label>
                <div className="inline-form-row">
                  <input id="remove-totp-code" className="code-field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={removalCode} disabled={busyAction === "mfa-remove"} onChange={(event) => setRemovalCode(event.target.value.replace(/\D/g, ""))} />
                  <button className="danger-action" type="submit" disabled={busyAction === "mfa-remove"}>确认移除</button>
                  <button className="secondary-action" type="button" onClick={() => setRemovingFactorId("")}>取消</button>
                </div>
              </form>
            ) : null}
            {enrollment ? (
              <form className="totp-enrollment" onSubmit={(event) => void handleVerifyEnrollment(event)}>
                <img src={qrCode} alt="Aibibu 两步认证二维码" />
                <div className="totp-enrollment-fields">
                  <label htmlFor="totp-code">身份验证器验证码</label>
                  <input id="totp-code" className="code-field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} disabled={busyAction === "mfa-verify"} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))} />
                  <span className="totp-secret">密钥：{enrollment.secret}</span>
                  <div className="form-actions">
                    <button className="primary-action" type="submit" disabled={busyAction === "mfa-verify"}>验证并启用</button>
                    <button className="secondary-action" type="button" disabled={busyAction === "mfa-cancel"} onClick={() => void handleCancelEnrollment()}>取消</button>
                  </div>
                </div>
              </form>
            ) : null}
          </section>

          <section className="account-section" id="sessions" aria-labelledby="sessions-title">
            <div className="account-section-heading">
              <div>
                <h2 id="sessions-title">Aibibu Auth 登录会话</h2>
                <p>管理中央账号在 Aibibu Auth 的登录会话。最近登录：{formatDate(account.lastSignInAt)}</p>
              </div>
            </div>
            <button className="session-action" type="button" disabled={busyAction === "sessions-others"} onClick={() => void handleSignOutOthers()}>
              <span><FiMonitor aria-hidden="true" /><span><strong>退出其他设备</strong><small>保留此浏览器的登录状态</small></span></span>
              <FiChevronRight aria-hidden="true" />
            </button>
            <button className="session-action session-action-danger" type="button" disabled={busyAction === "sessions-current"} onClick={() => void handleSignOutCurrent()}>
              <span><FiLogOut aria-hidden="true" /><span><strong>退出当前账号</strong><small>此浏览器需要重新登录</small></span></span>
              <FiChevronRight aria-hidden="true" />
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
