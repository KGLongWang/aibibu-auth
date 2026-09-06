import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { AccountPage } from "../account-page";

const auth = vi.hoisted(() => ({
  beginTotpEnrollment: vi.fn(),
  cancelTotpEnrollment: vi.fn(),
  linkAccountIdentity: vi.fn(),
  loadCentralAccount: vi.fn(),
  removeTotpFactor: vi.fn(),
  requestPasswordReauthentication: vi.fn(),
  signOutCurrentSession: vi.fn(),
  signOutOtherSessions: vi.fn(),
  updateAccountEmail: vi.fn(),
  updateAccountPassword: vi.fn(),
  verifyTotpEnrollment: vi.fn(),
}));

vi.mock("../supabase-auth", () => auth);

const account = {
  id: "user-123",
  email: "person@example.com",
  emailConfirmedAt: "2026-08-01T00:00:00Z",
  createdAt: "2026-07-01T00:00:00Z",
  lastSignInAt: "2026-08-30T04:00:00Z",
  identities: [
    { id: "email-identity", provider: "email" },
    { id: "google-identity", provider: "google" },
  ],
  factors: [],
  currentAal: "aal1",
};

describe("central account page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/account");
    auth.loadCentralAccount.mockResolvedValue(account);
    auth.requestPasswordReauthentication.mockResolvedValue(undefined);
    auth.updateAccountPassword.mockResolvedValue(undefined);
    auth.beginTotpEnrollment.mockResolvedValue({
      factorId: "factor-123",
      qrCode: "data:image/svg+xml;utf-8,%3Csvg%3E%3C/svg%3E",
      secret: "TESTSECRET",
    });
    auth.verifyTotpEnrollment.mockResolvedValue(undefined);
  });

  test("shows Supabase account identity, login methods, security, and sessions", async () => {
    render(<AccountPage />);

    expect(await screen.findByRole("heading", { name: "账号与安全" })).toBeVisible();
    expect(screen.getByText("person@example.com")).toBeVisible();
    expect(screen.getByText("Google")).toBeVisible();
    expect(screen.getByRole("button", { name: "连接" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Aibibu Auth 登录会话" })).toBeVisible();
    expect(screen.getByRole("button", { name: /退出其他设备/ })).toBeVisible();
  });

  test("returns to the embedding application at the top-level window", async () => {
    window.history.replaceState(
      {},
      "",
      "/account?return_to=http%3A%2F%2F127.0.0.1%3A5173%2Fprofile",
    );
    render(<AccountPage />);

    const returnLink = await screen.findByRole("link", { name: "返回应用" });
    expect(returnLink).toHaveAttribute("target", "_top");
  });

  test("hides duplicate navigation controls in embedded mode", async () => {
    window.history.replaceState(
      {},
      "",
      "/account?embedded=1&return_to=http%3A%2F%2F127.0.0.1%3A5173%2Fprofile",
    );
    render(<AccountPage />);

    expect(await screen.findByRole("heading", { name: "账号与安全" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "返回应用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "账号设置导航" })).not.toBeInTheDocument();
  });

  test("reauthenticates by email nonce before updating the central password", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.click(await screen.findByRole("button", { name: "更新" }));
    await user.type(screen.getByLabelText("新密码"), "NewPassword-2026!");
    await user.type(screen.getByLabelText("确认新密码"), "NewPassword-2026!");
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    await waitFor(() => expect(auth.requestPasswordReauthentication).toHaveBeenCalledOnce());
    expect(await screen.findByText("验证码已发送至 person@example.com。")).toBeVisible();
    await user.type(screen.getByLabelText("邮箱验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "确认并保存" }));

    await waitFor(() =>
      expect(auth.updateAccountPassword).toHaveBeenCalledWith("NewPassword-2026!", "123456"),
    );
    expect(await screen.findByText("密码已更新。")).toBeVisible();
  });

  test("enrolls and verifies a TOTP factor", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.click(await screen.findByRole("button", { name: "启用" }));
    expect(await screen.findByRole("img", { name: "Aibibu 两步认证二维码" })).toBeVisible();
    await user.type(screen.getByLabelText("身份验证器验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "验证并启用" }));

    await waitFor(() =>
      expect(auth.verifyTotpEnrollment).toHaveBeenCalledWith("factor-123", "123456"),
    );
  });

  test("requires login when there is no Supabase session", async () => {
    auth.loadCentralAccount.mockResolvedValue(null);
    render(<AccountPage />);

    expect(await screen.findByRole("heading", { name: "登录以管理账号" })).toBeVisible();
    expect(screen.getByRole("button", { name: "登录 Aibibu" })).toBeVisible();
  });
});
