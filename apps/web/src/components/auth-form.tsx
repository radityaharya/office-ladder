import { useState, useTransition } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { signIn, signUp } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

const SCREEN_COPY = {
  "sign-in": {
    formCode: "HR-114",
    kicker: "Badge check",
    heading: "Sign in to the floor terminal.",
    blurb:
      "Use your username or the email on your record. Everything you had open is still where you left it.",
    panelTitle: "Sign in",
    altLabel: "Create account",
    altTo: "/sign-up" as const,
    footnotePrompt: "No record on file?",
    footnoteLink: "Create an account",
  },
  "sign-up": {
    formCode: "HR-002",
    kicker: "New hire record",
    heading: "Open a personnel record.",
    blurb:
      "Your username is what the rest of the room sees while you climb from Intern to Director. Pick one you can live with.",
    panelTitle: "Create account",
    altLabel: "Sign in",
    altTo: "/sign-in" as const,
    footnotePrompt: "Already on payroll?",
    footnoteLink: "Sign in instead",
  },
} as const;

const SCREEN_NOTES: readonly (readonly [string, string])[] = [
  ["Roster", "3–6 per room"],
  ["Movement", "1d6 per turn"],
  ["Objective", "Reach Director first"],
];

/**
 * Shared chrome for both credential screens: a 48px bar, a form-record strip,
 * then two grid-aligned columns sharing one vertical hairline. The credential
 * panel is a rail column, not a card centred in free space (DESIGN.md §4.5).
 */
export function AuthScreen({ mode }: AuthFormProps) {
  const copy = SCREEN_COPY[mode];

  return (
    <main className="shell-page">
      <div className="shell-frame">
        <div className="shell-bar">
          <Link className="shell-label shell-brand" to="/">
            Office Ladder
          </Link>
          <Link className="shell-btn shell-btn-ghost shell-btn-sm" to={copy.altTo}>
            {copy.altLabel}
          </Link>
        </div>

        <div className="shell-strip">
          <div className="shell-strip-cell">
            <span className="shell-label shell-medium">Form</span>
            <span className="shell-data shell-high">{copy.formCode}</span>
          </div>
          <div className="shell-strip-cell">
            <span className="shell-label shell-medium">Issued by</span>
            <span className="shell-data shell-high">Facilities</span>
          </div>
          <div className="shell-strip-cell">
            <span className="shell-label shell-medium">Access</span>
            <span className="shell-strip-cell-inline">
              <span className="shell-led shell-led-caution" aria-hidden="true" />
              <span className="shell-data shell-high">Credentials required</span>
            </span>
          </div>
        </div>

        <div className="shell-rail-columns shell-frame-body">
          <div className="shell-region shell-region-tall shell-stack-wide">
            <div className="shell-stack">
              <span className="shell-label shell-medium">{copy.kicker}</span>
              <h1 className="shell-display shell-high">{copy.heading}</h1>
            </div>
            <p className="shell-body shell-medium shell-prose">{copy.blurb}</p>

            <div className="shell-panel">
              <div className="shell-panel-head">
                <span className="shell-label shell-high">Match record</span>
              </div>
              {SCREEN_NOTES.map(([label, value]) => (
                <div className="shell-note-row" key={label}>
                  <span className="shell-label shell-medium">{label}</span>
                  <span className="shell-data shell-high">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="shell-region shell-region-surface shell-stack-wide">
            <h2 className="shell-headline shell-high">{copy.panelTitle}</h2>
            <AuthForm mode={mode} />
            <p className="shell-footnote shell-body shell-medium">
              {copy.footnotePrompt}{" "}
              <Link className="shell-link" to={copy.altTo}>
                {copy.footnoteLink}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Employee-portal credential entry. Presentation only — the better-auth calls
 * and the branching between them are unchanged.
 */
export function AuthForm({ mode }: AuthFormProps) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSignUp = mode === "sign-up";
  const errorId = `${mode}-error`;
  const statusId = `${mode}-status`;

  function onSubmit(formData: FormData) {
    setError(null);

    startTransition(async () => {
      const username = String(formData.get("username") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      const result =
        isSignUp
          ? await signUp.email({
              name: username,
              username,
              email,
              password,
            })
          : username.includes("@")
            ? await signIn.email({ email: username, password })
            : await signIn.username({ username, password });

      if (result.error) {
        setError(result.error.message || "Authentication failed");
        return;
      }

      await navigate({ to: "/" });
    });
  }

  return (
    <form
      action={onSubmit}
      aria-busy={isPending}
      aria-describedby={statusId}
      className="shell-stack-wide"
    >
      <div className="shell-field">
        <label className="shell-field-label" htmlFor="username">
          {isSignUp ? "Username" : "Username or email"}
        </label>
        <input
          id="username"
          className="shell-input"
          name="username"
          type="text"
          autoComplete="username"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error !== null}
          minLength={3}
          maxLength={30}
          placeholder={isSignUp ? "intern-of-chaos" : "intern-of-chaos or email@company.com"}
          disabled={isPending}
          required
        />
      </div>

      {isSignUp ? (
        <div className="shell-field">
          <label className="shell-field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="shell-input"
            name="email"
            type="email"
            autoComplete="email"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error !== null}
            placeholder="you@office-ladder.club"
            disabled={isPending}
            required
          />
        </div>
      ) : null}

      <div className="shell-field">
        <label className="shell-field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="shell-input"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          aria-describedby={error ? errorId : "password-hint"}
          aria-invalid={error !== null}
          minLength={8}
          placeholder={isSignUp ? "8 characters minimum" : "Enter your password"}
          disabled={isPending}
          required
        />
        {isSignUp ? (
          <span className="shell-field-hint" id="password-hint">
            Eight characters minimum.
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="shell-msg shell-msg-error" id={errorId} role="alert">
          <span className="shell-led shell-led-critical shell-msg-led" aria-hidden="true" />
          <span className="shell-msg-body">
            <span className="shell-label shell-medium">Access denied</span> {error}
          </span>
        </p>
      ) : null}

      <button
        className="shell-btn shell-btn-primary shell-btn-lg shell-btn-block"
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending
          ? isSignUp
            ? "Creating account"
            : "Signing in"
          : isSignUp
            ? "Create account"
            : "Sign in"}
      </button>

      <p id={statusId} role="status" aria-live="polite" className="shell-sr-only">
        {isPending ? (isSignUp ? "Creating account" : "Signing in") : ""}
      </p>
    </form>
  );
}
