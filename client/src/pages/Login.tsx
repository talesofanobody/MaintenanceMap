import { FormEvent, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../App";

export default function Login() {
  const { state, login, setup } = useAuth();
  const isSetup = state.status === "needs-setup";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSetup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      if (isSetup) {
        await setup(username, password);
      } else {
        await login(username, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand">
          <BrandMark />
          <h1>MaintenanceMap</h1>
        </div>
        <h2>{isSetup ? "Create your account" : "Sign in"}</h2>
        {isSetup && (
          <p className="muted small">
            No account exists yet. This app uses a single account — pick the username and password you'll sign in with
            from now on, including from your phone.
          </p>
        )}

        {error && <div className="banner banner-error">{error}</div>}

        <form className="form" onSubmit={handleSubmit}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSetup ? "new-password" : "current-password"}
            />
          </label>
          {isSetup && (
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          )}
          <button type="submit" className="btn btn-primary btn-large" disabled={submitting}>
            {submitting ? "Please wait…" : isSetup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
