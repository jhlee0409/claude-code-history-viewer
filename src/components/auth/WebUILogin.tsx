import { type FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2, Lock, ShieldCheck, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginWebUI } from "@/utils/platform";

type LoginMode = "account" | "token";

interface WebUILoginProps {
  onAuthenticated: () => void;
}

export default function WebUILogin({ onAuthenticated }: WebUILoginProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<LoginMode>("account");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;
    if (mode === "account") {
      return username.trim().length > 0 && password.length > 0;
    }
    return token.trim().length > 0;
  }, [isSubmitting, mode, password, token, username]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setIsSubmitting(true);
    const result =
      mode === "account"
        ? await loginWebUI({ username, password })
        : await loginWebUI({ token });
    setIsSubmitting(false);

    if (result.ok) {
      onAuthenticated();
      return;
    }

    setError(
      result.status === 429
        ? t("webui.login.errorRateLimited")
        : t("webui.login.errorFailed"),
    );
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-[420px] rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">
              {t("webui.login.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("common.appName")}
            </p>
          </div>
        </div>

        <div
          className="mb-5 grid grid-cols-2 rounded-md border border-border bg-muted p-1"
          role="tablist"
          aria-label={t("webui.login.methodLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "account"}
            className={`flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-medium transition-colors ${
              mode === "account"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setMode("account");
              setError(null);
            }}
          >
            <User className="h-4 w-4" aria-hidden="true" />
            {t("webui.login.account")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "token"}
            className={`flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-medium transition-colors ${
              mode === "token"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => {
              setMode("token");
              setError(null);
            }}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {t("webui.login.token")}
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === "account" ? (
            <>
              <label className="block space-y-2">
                <span className="text-sm font-medium">
                  {t("webui.login.username")}
                </span>
                <div className="relative">
                  <User
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    autoComplete="username"
                    className="pl-9"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium">
                  {t("webui.login.password")}
                </span>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="password"
                    autoComplete="current-password"
                    className="pl-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </label>
            </>
          ) : (
            <label className="block space-y-2">
              <span className="text-sm font-medium">
                {t("webui.login.accessToken")}
              </span>
              <div className="relative">
                <KeyRound
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="password"
                  autoComplete="off"
                  className="pl-9"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </label>
          )}

          {error ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <Button className="w-full" type="submit" disabled={!canSubmit}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {t("webui.login.submit")}
          </Button>
        </form>
      </section>
    </main>
  );
}
