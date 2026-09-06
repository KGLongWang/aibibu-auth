import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { App } from "../App";

const auth = vi.hoisted(() => ({
  approveOAuthAuthorization: vi.fn(),
  currentAuthSession: vi.fn(),
  denyOAuthAuthorization: vi.fn(),
  getOAuthAuthorization: vi.fn(),
  sendEmailCode: vi.fn(),
  signInWithPassword: vi.fn(),
  signOutCurrentSession: vi.fn(),
  startSocialLogin: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
const authMethod = vi.hoisted(() => ({ lookupAuthMethod: vi.fn() }));

vi.mock("../supabase-auth", () => auth);
vi.mock("../auth-method", () => authMethod);

describe("Aibibu Auth UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
    auth.currentAuthSession.mockResolvedValue(null);
    auth.signOutCurrentSession.mockResolvedValue(undefined);
    auth.approveOAuthAuthorization.mockResolvedValue(
      "http://127.0.0.1:5173/oauth/oidc?code=approved",
    );
    auth.denyOAuthAuthorization.mockResolvedValue(
      "http://127.0.0.1:5173/oauth/oidc?error=access_denied",
    );
    auth.getOAuthAuthorization.mockResolvedValue({
      kind: "consent",
      details: {
        authorizationId: "authorization-123",
        client: {
          name: "New API",
          uri: "http://127.0.0.1:5173",
          logoUri: "",
        },
        email: "person@example.com",
        scopes: ["openid", "email", "profile"],
      },
    });
    authMethod.lookupAuthMethod.mockResolvedValue("otp");
    auth.sendEmailCode.mockResolvedValue(undefined);
    auth.signInWithPassword.mockResolvedValue({
      accessToken: "password-access-token",
      expiresAt: 1_900_000_000,
    });
    auth.startSocialLogin.mockResolvedValue(undefined);
    auth.verifyEmailCode.mockResolvedValue({
      accessToken: "verified-access-token",
      expiresAt: 1_900_000_000,
    });
  });

  test("offers LinuxDO, Google, and unified email login", async () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "使用 LinuxDO 继续" })).toBeVisible();
    expect(screen.getByRole("button", { name: "使用 Google 继续" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "邮箱地址" })).toBeVisible();
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  });

  test("sends a six-digit code before verifying the email", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "邮箱地址" }), "person@example.com");
    await user.click(screen.getByRole("button", { name: "继续" }));

    await waitFor(() => {
      expect(authMethod.lookupAuthMethod).toHaveBeenCalledWith("person@example.com");
      expect(auth.sendEmailCode).toHaveBeenCalledWith("person@example.com");
    });
    expect(screen.getByRole("heading", { name: "验证你的邮箱" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "6 位验证码" })).toHaveFocus();
  });

  test("routes an existing password account to password login", async () => {
    const user = userEvent.setup();
    authMethod.lookupAuthMethod.mockResolvedValue("password");
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "邮箱地址" }), "person@example.com");
    await user.click(screen.getByRole("button", { name: /^继续$/ }));

    expect(await screen.findByRole("heading", { name: "输入密码" })).toBeVisible();
    expect(auth.sendEmailCode).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: /^登录$/ }));

    await waitFor(() => {
      expect(auth.signInWithPassword).toHaveBeenCalledWith(
        "person@example.com",
        "correct horse battery staple",
      );
    });
    expect(screen.getByRole("heading", { name: "登录成功" })).toBeVisible();
  });

  test("lets a password account switch to email code login", async () => {
    const user = userEvent.setup();
    authMethod.lookupAuthMethod.mockResolvedValue("password");
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "邮箱地址" }), "person@example.com");
    await user.click(screen.getByRole("button", { name: /^继续$/ }));
    await user.click(await screen.findByRole("button", { name: "使用邮箱验证码登录" }));

    await waitFor(() => {
      expect(auth.sendEmailCode).toHaveBeenCalledWith("person@example.com");
    });
    expect(screen.getByRole("heading", { name: "验证你的邮箱" })).toBeVisible();
  });

  test("falls back to OTP when the method service is unavailable", async () => {
    const user = userEvent.setup();
    authMethod.lookupAuthMethod.mockRejectedValue(new Error("offline"));
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "邮箱地址" }), "person@example.com");
    await user.click(screen.getByRole("button", { name: /^继续$/ }));

    await waitFor(() => {
      expect(auth.sendEmailCode).toHaveBeenCalledWith("person@example.com");
    });
    expect(screen.getByRole("heading", { name: "验证你的邮箱" })).toBeVisible();
  });

  test("opens Google OAuth in a separate top-level auth window", async () => {
    const user = userEvent.setup();
    const popup = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
    };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "使用 Google 继续" }));

    const popupUrl = new URL(String(open.mock.calls[0]?.[0]));
    const channelState = popupUrl.searchParams.get("channel_state");
    expect(popupUrl.origin).toBe(window.location.origin);
    expect(popupUrl.searchParams.get("flow")).toBe("social");
    expect(popupUrl.searchParams.get("provider")).toBe("google");
    expect(channelState).toHaveLength(48);
    expect(auth.startSocialLogin).not.toHaveBeenCalled();
    expect(popup.focus).toHaveBeenCalledOnce();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "aibibu.auth.social.success",
          access_token: "wrong-origin-token",
          state: channelState,
        },
        origin: "https://evil.example",
        source: popup as unknown as Window,
      }),
    );
    expect(screen.getByRole("heading", { name: "登录或创建账户" })).toBeVisible();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "aibibu.auth.social.success",
          access_token: "social-access-token",
          state: channelState,
        },
        origin: window.location.origin,
        source: popup as unknown as Window,
      }),
    );
    expect(await screen.findByRole("heading", { name: "登录成功" })).toBeVisible();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  test("starts Supabase PKCE from inside the top-level social window", async () => {
    window.history.replaceState({}, "", "/?flow=social&provider=google&channel_state=social-state");

    render(<App />);

    await waitFor(() => {
      expect(auth.startSocialLogin).toHaveBeenCalledWith(
        "google",
        `${window.location.origin}/callback`,
      );
    });
    expect(screen.getByRole("heading", { name: "正在连接账户" })).toBeVisible();
  });

  test("asks before using an existing Supabase session", async () => {
    window.history.replaceState({}, "", "/authorize?authorization_id=authorization-123");
    auth.currentAuthSession.mockResolvedValue({
      authResult: {
        accessToken: "supabase-access-token",
        expiresAt: 1_900_000_000,
      },
      email: "person@example.com",
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "选择账号" })).toBeVisible();
    expect(screen.getByRole("button", { name: "以 person@example.com 继续" })).toBeVisible();
    expect(screen.getByRole("button", { name: "使用其他账号" })).toBeVisible();
    expect(auth.getOAuthAuthorization).not.toHaveBeenCalled();
  });

  test("continues the standard OIDC authorization with the selected session", async () => {
    const user = userEvent.setup();
    const postMessage = vi.spyOn(window, "postMessage");
    window.history.replaceState({}, "", "/authorize?authorization_id=authorization-123");
    auth.currentAuthSession.mockResolvedValue({
      authResult: {
        accessToken: "supabase-access-token",
        expiresAt: 1_900_000_000,
      },
      email: "person@example.com",
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "以 person@example.com 继续" }),
    );
    expect(await screen.findByRole("heading", { name: "授权 New API" })).toBeVisible();
    expect(auth.getOAuthAuthorization).toHaveBeenCalledWith("authorization-123");
    expect(screen.getByText("读取你的邮箱地址")).toBeVisible();
    expect(screen.getByRole("button", { name: "允许并继续" })).toBeVisible();
    expect(postMessage).not.toHaveBeenCalled();
  });

  test("asks the parent to restart an expired OAuth authorization without exposing the raw error", async () => {
    const user = userEvent.setup();
    const postMessage = vi.spyOn(window.parent, "postMessage");
    window.history.replaceState({}, "", "/authorize?authorization_id=expired-authorization");
    auth.currentAuthSession.mockResolvedValue({
      authResult: {
        accessToken: "supabase-access-token",
        expiresAt: 1_900_000_000,
      },
      email: "person@example.com",
    });
    auth.getOAuthAuthorization.mockRejectedValue(
      Object.assign(new Error("authorization not found"), {
        code: "oauth_authorization_not_found",
      }),
    );

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "以 person@example.com 继续" }),
    );

    expect(await screen.findByRole("heading", { name: "正在重新连接" })).toBeVisible();
    expect(screen.queryByText("authorization not found")).not.toBeInTheDocument();
    expect(postMessage).toHaveBeenCalledWith(
      { type: "aibibu.auth.oauth.retry" },
      "*",
    );
  });

  test("signs out only the current session before choosing another account", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/authorize?authorization_id=authorization-123");
    auth.currentAuthSession.mockResolvedValue({
      authResult: {
        accessToken: "supabase-access-token",
        expiresAt: 1_900_000_000,
      },
      email: "person@example.com",
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "使用其他账号" }));

    await waitFor(() => expect(auth.signOutCurrentSession).toHaveBeenCalledOnce());
    expect(screen.getByRole("heading", { name: "登录或创建账户" })).toBeVisible();
    expect(screen.getByRole("button", { name: "使用 Google 继续" })).toBeVisible();
    expect(auth.getOAuthAuthorization).not.toHaveBeenCalled();
  });
});
