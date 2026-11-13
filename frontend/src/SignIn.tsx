import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icons";
import { Landscape } from "./Landscape";
import type { ThemeId } from "./ThemePicker";

type GoogleIdentity = {
  accounts: { id: {
    initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
    renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
  } };
};

declare global {
  interface Window { google?: GoogleIdentity }
}

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`);
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Google sign-in could not load.")), { once: true });
    if (!existing) {
      script.src = GOOGLE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

function GoogleButton({ clientId, disabled, onCredential }: { clientId: string; disabled: boolean; onCredential: (credential: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadGoogleScript().then(() => {
      if (!active || !container.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: response => { if (response.credential) callback.current(response.credential); },
      });
      window.google.accounts.id.renderButton(container.current, {
        theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 320,
      });
    }).catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [clientId]);

  if (failed) return <p className="muted">Google sign-in could not load. Use email or guest access instead.</p>;
  return <div className={`google-button ${disabled ? "disabled" : ""}`} ref={container} aria-busy={disabled} />;
}

export function Brand() {
  return <div className="brand">
    <span className="brand-mark"><Icon name="mark" size={22} /></span>
    <span><strong>Global RAG</strong><small>Research workspace</small></span>
  </div>;
}

type Shared = {
  busy: boolean;
  notice: ReactNode;
  themeControl: ReactNode;
  theme: ThemeId;
  motionEnabled: boolean;
};

function Arrival({ theme, motionEnabled, themeControl, children }: Pick<Shared, "theme" | "motionEnabled" | "themeControl"> & { children: ReactNode }) {
  return <div className="arrival">
    <Landscape theme={theme} motionEnabled={motionEnabled} />
    <header className="arrival-masthead">
      <Brand />
      <div className="masthead-actions">
        {themeControl}
        <a className="button secondary arrival-docs" href="#docs/overview" aria-label="Documentation"><Icon name="book" size={17} /><span>Documentation</span></a>
      </div>
    </header>
    <main className="arrival-grid">
      <div className="arrival-copy">
        <p className="arrival-kicker"><span /> A workspace for your knowledge</p>
        <h1>Find the <em>signal.</em></h1>
        <p className="arrival-description">Search across your documents, ask questions in plain language, and follow each citation back to its source.</p>
      </div>
      {children}
    </main>
    <footer className="arrival-footer">
      <span><Icon name="folder" size={17} /> Bring your sources</span>
      <span><Icon name="chat" size={17} /> Ask your own questions</span>
      <span><Icon name="file" size={17} /> See the supporting passages</span>
    </footer>
  </div>;
}

export function SignIn({ busy, notice, themeControl, theme, motionEnabled, googleClientId, onGuest, onEmail, onGoogle }: Shared & {
  googleClientId: string | null;
  onGuest: () => void;
  onEmail: (mode: "login" | "register", email: string, password: string, name: string) => Promise<boolean>;
  onGoogle: (credential: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const registering = mode === "register";

  return <Arrival theme={theme} motionEnabled={motionEnabled} themeControl={themeControl}>
    <section className="arrival-card" aria-labelledby="sign-in-title">
      <div className="arrival-card-icon"><Icon name="user" size={20} /></div>
      <h2 id="sign-in-title">{registering ? "Create your account" : "Welcome back"}</h2>
      <p>{registering ? "Your sessions and documents stay private to your account." : "Sign in to restore your sessions, or try it as a guest."}</p>

      {googleClientId && <>
        <GoogleButton clientId={googleClientId} disabled={busy} onCredential={onGoogle} />
        <div className="auth-divider"><span>or</span></div>
      </>}

      <form className="auth-form" onSubmit={event => {
        event.preventDefault();
        void onEmail(mode, email.trim(), password, name.trim()).then(success => { if (success) setPassword(""); });
      }}>
        {registering && <label>Name <small>Optional</small>
          <input autoComplete="name" placeholder="Your name" value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        </label>}
        <label>Email
          <input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} />
        </label>
        <label>Password {registering && <small>At least 8 characters</small>}
          <input type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : undefined} placeholder={registering ? "Choose a password" : "Your password"} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
        </label>
        {notice}
        <button className="button primary arrival-submit" disabled={busy || !email.trim() || !password || (registering && password.length < 8)}>
          {busy ? "Signing in…" : registering ? "Create account" : "Sign in with email"}
          {busy ? <span className="spinner" /> : <Icon name="arrow" size={17} />}
        </button>
      </form>

      <button type="button" className="text-button" disabled={busy} onClick={() => setMode(registering ? "login" : "register")}>
        {registering ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
      <div className="auth-divider"><span>or</span></div>
      <button type="button" className="button secondary guest-button" disabled={busy} onClick={onGuest}>
        <Icon name="user" size={17} /> Continue as guest
      </button>
      <p className="muted guest-note">Guest sessions are tied to this browser. Create an account to keep them across devices.</p>
    </section>
  </Arrival>;
}

export function AdminSignIn({ busy, notice, themeControl, theme, motionEnabled, onSignIn }: Shared & {
  onSignIn: (username: string, password: string) => Promise<boolean>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return <Arrival theme={theme} motionEnabled={motionEnabled} themeControl={themeControl}>
    <form className="arrival-card" aria-labelledby="admin-title" onSubmit={event => {
      event.preventDefault();
      void onSignIn(username.trim(), password).then(success => { if (success) setPassword(""); });
    }}>
      <div className="arrival-card-icon"><Icon name="lock" size={20} /></div>
      <h2 id="admin-title">Admin sign-in</h2>
      <p>Restricted to the workspace administrator.</p>
      <label>Username
        <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} disabled={busy} onChange={event => setUsername(event.target.value)} />
      </label>
      <label>Password
        <input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
      </label>
      {notice}
      <button className="button primary arrival-submit" disabled={busy || !username.trim() || !password}>
        {busy ? "Signing in…" : "Sign in as admin"}
        {busy ? <span className="spinner" /> : <Icon name="arrow" size={17} />}
      </button>
      <a className="text-button" href="#">Back to user sign-in</a>
    </form>
  </Arrival>;
}
