import { useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icons";
import { Landscape } from "./Landscape";
import type { ThemeId } from "./ThemePicker";

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{32,128}$/;

// People often paste a whole config line such as WORKSPACE_TOKENS='{"team":"<token>"}'.
// Use the token inside it when there is exactly one; otherwise send the text unchanged.
function cleanToken(raw: string) {
  const text = raw.trim();
  if (TOKEN_FORMAT.test(text)) return text;
  const candidates = text.match(/[A-Za-z0-9_-]{32,128}/g) ?? [];
  return candidates.length === 1 ? candidates[0] : text;
}

const localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "5173";
const hostedDemo = window.location.protocol === "https:" && import.meta.env.VITE_ENABLE_HOSTED_DEMO_LOGIN === "true";

export function Brand() {
  return <div className="brand">
    <span className="brand-mark"><Icon name="mark" size={22} /></span>
    <span><strong>Global RAG</strong><small>Research workspace</small></span>
  </div>;
}

export function SignIn({ busy, notice, connect, signIn, themeControl, theme, motionEnabled }: {
  busy: boolean;
  notice: ReactNode;
  connect: (token: string) => void;
  signIn: (username: string, password: string) => Promise<boolean>;
  themeControl: ReactNode;
  theme: ThemeId;
  motionEnabled: boolean;
}) {
  const [useToken, setUseToken] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [workspaceToken, setWorkspaceToken] = useState("");

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
      <form className="arrival-card" onSubmit={event => {
        event.preventDefault();
        if (useToken) connect(cleanToken(workspaceToken));
        else void signIn(username.trim(), password).then(success => { if (success) setPassword(""); });
      }}>
        <div className="arrival-card-icon"><Icon name="lock" size={20} /></div>
        <h2>Enter the workspace</h2>
        <p>{useToken ? "Use the access token from your workspace." : "Sign in to the demo workspace."}</p>
        {useToken ? <label>Workspace token
          <input type="password" autoComplete="off" placeholder="Paste your workspace token" value={workspaceToken} disabled={busy} onChange={event => setWorkspaceToken(event.target.value)} />
        </label> : <>
          <label>Username
            <input autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter your username" value={username} disabled={busy} onChange={event => setUsername(event.target.value)} />
          </label>
          <label>Password
            <input type="password" autoComplete="current-password" placeholder="Enter your password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
          </label>
        </>}
        {notice}
        <button className="button primary arrival-submit" disabled={busy || (useToken ? !workspaceToken.trim() : !username.trim() || !password)}>
          {busy ? "Connecting…" : useToken ? "Connect workspace" : "Sign in"}
          {busy ? <span className="spinner" /> : <Icon name="arrow" size={17} />}
        </button>
        {(localPreview || hostedDemo) && <button type="button" className="text-button" disabled={busy} onClick={() => setUseToken(!useToken)}>
          {useToken ? "Use admin login" : "Use a workspace token instead"}
        </button>}
      </form>
    </main>
    <footer className="arrival-footer">
      <span><Icon name="folder" size={17} /> Bring your sources</span>
      <span><Icon name="chat" size={17} /> Ask your own questions</span>
      <span><Icon name="file" size={17} /> See the supporting passages</span>
    </footer>
  </div>;
}
