import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { addUrl, adminLogin, ask, authConfig, createSession, emailLogin, getIdentity, googleLogin, guestLogin, listSessions, loadSession, logout, registerAccount, upload } from "./api";
import { AdminUsers } from "./AdminUsers";
import type { AuthResult } from "./types";
import { Icon } from "./Icons";
import { Landscape } from "./Landscape";
import { AdminSignIn, Brand, SignIn } from "./SignIn";
import { applyTheme, readBackgroundMotion, readTheme, saveBackgroundMotion, ThemePicker } from "./ThemePicker";
import { modelIssue, ModelSettings, providers } from "./ModelSettings";
import { SourceLibrary, uploadIssue } from "./SourceLibrary";
import type { Notice } from "./SourceLibrary";
import type { ChatMessage, CorpusProfile, Identity, SessionState, SessionSummary, Settings, Source } from "./types";

const DocsView = lazy(() => import("./DocsView"));
const defaults: Settings = {
  credential_mode: "user",
  provider: "openai",
  model: providers.openai.model,
  api_key: "",
  embedding_provider: "openai",
  vector_store: "faiss",
  chunk_size: 900,
  chunk_overlap: 150,
};
const suggestions = ["Summarize the key points", "Compare the main findings", "What evidence supports the conclusion?"];
const activeSessionKey = "global-rag-active-session";
const authKey = "global-rag-auth";
const questionLimit = 12000;
type Panel = "workspace" | "settings" | "sources" | "theme" | "users";

function readStored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Without browser storage the user signs in again after a reload.
  }
}
type Activity = "session" | "upload" | "answer";

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sessionName(session: SessionSummary) {
  const date = new Date(session.created_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return `${date} · ${session.session_id.slice(0, 4)}`;
}

function Overlay({ title, description, onDismiss, children }: {
  title: string;
  description: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return <dialog className="overlay" ref={dialog} onClose={onDismiss} aria-labelledby="panel-title" aria-describedby="panel-description">
    <div className="overlay-header">
      <div><h2 id="panel-title">{title}</h2><p id="panel-description">{description}</p></div>
      <button className="button icon-button" aria-label="Close panel" onClick={() => dialog.current?.close()}><Icon name="close" /></button>
    </div>
    <div className="overlay-body">{children}</div>
  </dialog>;
}

function Message({ message }: { message: ChatMessage }) {
  const assistant = message.role === "assistant";
  const [copyStatus, setCopyStatus] = useState("");

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy unavailable");
    }
  }

  return <article className={`message ${message.role}`}>
    <span className="avatar" aria-hidden="true">{assistant ? <Icon name="spark" size={17} /> : "Y"}</span>
    <div className="message-body">
      <div className="message-heading">
        <strong>{assistant ? "Global RAG" : "You"}</strong>
        {assistant && <button className="button copy-button" onClick={() => void copyAnswer()}>
          <Icon name={copyStatus === "Copied" ? "check" : "copy"} size={14} />{copyStatus || "Copy answer"}
        </button>}
        <span className="visually-hidden" role="status">{copyStatus}</span>
      </div>
      {assistant ? <div className="message-text">
        <ReactMarkdown disallowedElements={["img"]} components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}>{message.content}</ReactMarkdown>
      </div> : <p className="question-text">{message.content}</p>}
      {Boolean(message.citations?.length) && <div className="evidence">
        <p className="section-label">Evidence <span className="count">{message.citations?.length}</span></p>
        {message.citations?.map(citation => <details key={citation.number}>
          <summary>
            <span className="citation-number">{citation.number}</span>
            <span className="citation-label">{citation.source}{citation.page ? ` · page ${citation.page}` : ""}{citation.sheet ? ` · sheet ${citation.sheet}` : ""}</span>
            <Icon name="chevron" size={15} />
          </summary>
          <p>{citation.excerpt}</p>
        </details>)}
      </div>}
    </div>
  </article>;
}

export default function App() {
  const [theme, setTheme] = useState(readTheme);
  const [motionEnabled, setMotionEnabled] = useState(readBackgroundMotion);
  const [settings, setSettings] = useState(defaults);
  const [token, setToken] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [profile, setProfile] = useState<CorpusProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [url, setUrl] = useState("");
  const [input, setInput] = useState("");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sourceNotice, setSourceNotice] = useState<Notice | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);
  const [showLatest, setShowLatest] = useState(false);
  const followMessages = useRef(true);
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const issue = modelIssue(settings);
  const busy = activity !== null;
  const canUseProviders = Boolean(token && sessionId && !issue && !busy);
  const docsOpen = hash.startsWith("#docs/");

  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  useEffect(() => {
    if (followMessages.current && thread.current) {
      thread.current.scrollTop = thread.current.scrollHeight;
    }
  }, [messages, activity, docsOpen]);

  function scrollToLatest() {
    followMessages.current = true;
    setShowLatest(false);
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }

  const update = (patch: Partial<Settings>) => setSettings(current => ({ ...current, ...patch }));

  function applySession(session: SessionState & { messages: ChatMessage[] }) {
    const saved = session.profile;
    followMessages.current = true;
    setShowLatest(false);
    setSessionId(session.session_id);
    setProfile(saved);
    setSources(session.sources);
    setMessages(session.messages);
    setSourceNotice(null);
    setInput("");
    setUrl("");
    if (saved) {
      setSettings(current => {
        const azureChanged = Boolean(saved.azure_endpoint && saved.azure_endpoint !== current.azure_endpoint);
        return {
          ...current, ...saved.index,
          embedding_provider: saved.embedding_provider,
          embedding_model: saved.embedding_provider === "azure_openai" ? "" : saved.embedding_model,
          azure_embedding_deployment: saved.embedding_provider === "azure_openai" ? saved.embedding_model : undefined,
          azure_endpoint: saved.azure_endpoint || current.azure_endpoint,
          api_version: saved.api_version || current.api_version,
          api_key: azureChanged && current.provider === "azure_openai" ? "" : current.api_key,
          embedding_api_key: azureChanged || current.embedding_provider !== saved.embedding_provider ? "" : current.embedding_api_key,
        };
      });
    }
    try {
      localStorage.setItem(activeSessionKey, session.session_id);
    } catch {
      // The API still lists recent sessions when browser storage is unavailable.
    }
  }

  async function openSession(access: string, selectedId?: string, fresh = false) {
    if (!access || busy) return false;
    setActivity("session");
    setNotice(null);
    try {
      const identityResponse = await getIdentity(access);
      let recent = await listSessions(access);
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(activeSessionKey);
      } catch {
        // Fall back to the most recent session.
      }
      let id = selectedId || recent.find(item => item.session_id === remembered)?.session_id || recent[0]?.session_id;
      if (fresh || !id) {
        id = (await createSession(access)).session_id;
        recent = [{ session_id: id, created_at: new Date().toISOString() }, ...recent];
      }
      applySession(await loadSession(access, id));
      setSessions(recent);
      setIdentity(identityResponse);
      setToken(access);
      writeStored(authKey, access);
      setPanel(null);
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: messageFrom(error, "Unable to open the workspace.") });
      return false;
    } finally {
      setActivity(null);
    }
  }

  async function authenticate(attempt: () => Promise<AuthResult>, fallback: string) {
    if (busy) return false;
    setActivity("session");
    setNotice(null);
    let access = "";
    try {
      access = (await attempt()).token;
    } catch (error) {
      setNotice({ tone: "error", text: messageFrom(error, fallback) });
      setActivity(null);
      return false;
    }
    setActivity(null);
    return openSession(access);
  }

  const signInGuest = () => void authenticate(guestLogin, "Unable to start a guest session.");
  const signInEmail = (mode: "login" | "register", email: string, password: string, name: string) =>
    authenticate(() => mode === "register" ? registerAccount(email, password, name) : emailLogin(email, password), "Unable to sign in.");
  const signInGoogle = (credential: string) => void authenticate(() => googleLogin(credential), "Google sign-in failed.");
  const signInAdmin = (username: string, password: string) => authenticate(() => adminLogin(username, password), "Unable to sign in.");

  useEffect(() => {
    authConfig().then(config => setGoogleClientId(config.google_client_id)).catch(() => setGoogleClientId(null));
    const stored = readStored(authKey);
    if (stored) {
      void openSession(stored).then(success => {
        if (!success) {
          writeStored(authKey, null);
          setNotice(null);
        }
      });
    }
    // Restore once on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function disconnect() {
    if (token) void logout(token);
    writeStored(authKey, null);
    setToken("");
    setIdentity(null);
    setSessionId("");
    setSessions([]);
    setProfile(null);
    setSettings(defaults);
    setMessages([]);
    setSources([]);
    setInput("");
    setUrl("");
    setNotice(null);
    setSourceNotice(null);
    setPanel(null);
    setShowLatest(false);
    followMessages.current = true;
  }

  async function ingestFiles(files: File[]) {
    if (!canUseProviders) return;
    const problem = uploadIssue(files);
    if (problem) {
      setSourceNotice({ tone: "error", text: problem });
      return;
    }
    setActivity("upload");
    setSourceNotice(null);
    try {
      const result = await upload(token, sessionId, files, settings);
      setSources(result.sources);
      setProfile(result.profile);
      setSourceNotice({ tone: "success", text: result.documents
        ? `Indexed ${result.documents} ${result.documents === 1 ? "file" : "files"} · ${result.chunks} ${result.chunks === 1 ? "passage" : "passages"}.`
        : "These files are already indexed." });
    } catch (error) {
      setSourceNotice({ tone: "error", text: messageFrom(error, "Upload failed. Please try again.") });
    } finally {
      setActivity(null);
    }
  }

  async function ingestUrl() {
    if (!url.trim() || !canUseProviders) return;
    setActivity("upload");
    setSourceNotice(null);
    try {
      const result = await addUrl(token, sessionId, url.trim(), settings);
      setSources(result.sources);
      setProfile(result.profile);
      setSourceNotice({ tone: "success", text: result.documents ? "Webpage indexed." : "This webpage is already indexed." });
      setUrl("");
    } catch (error) {
      setSourceNotice({ tone: "error", text: messageFrom(error, "URL import failed. Please try again.") });
    } finally {
      setActivity(null);
    }
  }

  async function send() {
    const question = input.trim();
    if (!question || !canUseProviders) return;
    setInput("");
    setNotice(null);
    scrollToLatest();
    setMessages(current => [...current, { role: "user", content: question }]);
    setActivity("answer");
    try {
      const result = await ask(token, sessionId, question, settings);
      setMessages(current => [...current, { role: "assistant", content: result.answer, citations: result.citations }]);
    } catch (error) {
      setMessages(current => current.slice(0, -1));
      setInput(question);
      setNotice({ tone: "error", text: messageFrom(error, "The question could not be completed.") });
    } finally {
      setActivity(null);
    }
  }

  const workspaceControls = token ? <div className="workspace-controls">
    <label>Active session
      <select value={sessionId} disabled={busy} onChange={event => void openSession(token, event.target.value)}>
        {sessions.map(session => <option value={session.session_id} key={session.session_id}>{sessionName(session)}</option>)}
      </select>
    </label>
    <button className="button secondary" disabled={busy} onClick={() => void openSession(token, undefined, true)}>
      <Icon name="plus" size={17} /> New session
    </button>
    <button className="button quiet" disabled={busy} onClick={disconnect}><Icon name="logout" size={17} /> Sign out</button>
  </div> : <p className="muted">Connect to browse sessions and restore your chat.</p>;

  const libraryProps = {
    sources, busy, uploading: activity === "upload", notice: sourceNotice, url, setUrl,
    disabledReason: !token ? "Connect a workspace to add sources." : issue,
    onFiles: (files: File[]) => void ingestFiles(files), onUrl: () => void ingestUrl(),
    onConfigure: token && issue && !busy ? () => setPanel("settings") : undefined,
  };
  const statusNotice = notice && <p className={`notice ${notice.tone}`} role="status"><Icon name="info" size={17} />{notice.text}</p>;

  const themeControl = <button className="button secondary theme-trigger" onClick={() => setPanel("theme")} aria-label="Choose theme">
    <Icon name="palette" size={17} /><span>Theme</span>
  </button>;
  const themeOverlay = panel === "theme" && <Overlay title="Choose a theme" description="Change the artwork and colors across your workspace." onDismiss={() => setPanel(null)}>
    <ThemePicker selected={theme} onChange={setTheme} />
    <label className="theme-motion">
      <input type="checkbox" checked={motionEnabled} onChange={event => {
        setMotionEnabled(event.target.checked);
        saveBackgroundMotion(event.target.checked);
      }} />
      <span><strong>Animate backgrounds</strong><small>Respects your device’s reduced motion setting.</small></span>
    </label>
    <form className="overlay-footer" method="dialog"><button className="button primary">Done <Icon name="check" size={17} /></button></form>
  </Overlay>;

  if (docsOpen) return <>
    <Suspense fallback={<main className="docs-loading" role="status">Loading documentation…</main>}>
      <DocsView hash={hash} themeControl={themeControl} />
    </Suspense>
    {themeOverlay}
  </>;

  if (!token) return <>
    {hash === "#admin"
      ? <AdminSignIn busy={busy} notice={statusNotice} onSignIn={signInAdmin}
          themeControl={themeControl} theme={theme} motionEnabled={motionEnabled} />
      : <SignIn busy={busy} notice={statusNotice} googleClientId={googleClientId}
          onGuest={signInGuest} onEmail={signInEmail} onGoogle={signInGoogle}
          themeControl={themeControl} theme={theme} motionEnabled={motionEnabled} />}
    {themeOverlay}
  </>;

  const isAdmin = identity?.authentication === "admin";
  const accountLabel = isAdmin ? "Administrator" : identity?.user?.name || identity?.user?.email || "Guest";

  return <div className="app-shell" onDragOver={event => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  }} onDrop={event => {
    if (event.dataTransfer.files.length) event.preventDefault();
  }}>
    <aside className="sidebar" aria-label="Workspace">
      <Brand />
      <div className="sidebar-main">
        <p className="section-label">Workspace</p>
        <div className="active-nav"><Icon name="chat" /> Document chat</div>
        <div className="rail-session">{workspaceControls}</div>
      </div>
      <div className="sidebar-bottom">
        <p className="account-chip"><Icon name={isAdmin ? "lock" : "user"} size={15} /><span>{accountLabel}</span></p>
        {isAdmin && <button className="button quiet" onClick={() => setPanel("users")} disabled={busy}><Icon name="users" /> Users</button>}
        <button className="button quiet" onClick={() => setPanel("settings")} disabled={!token || busy}><Icon name="settings" /> Model settings</button>
        <a className="button quiet" href="#docs/overview"><Icon name="book" /> Documentation</a>
        <p className="privacy"><Icon name="lock" size={14} /> Provider keys stay in this browser tab and are sent only to the configured API.</p>
      </div>
    </aside>

    <main className="chat">
      <header className="chat-header">
        <div className="mobile-brand"><Brand /></div>
        <div className="chat-heading"><p className="section-label">Workspace</p><h1>Document chat</h1></div>
        <div className="header-actions">
          <span className={`connection ${token ? "connected" : ""}`}><i />{token ? "Connected" : "Not connected"}</span>
          {themeControl}
          <a className="button secondary mobile-docs" href="#docs/overview" aria-label="Documentation"><Icon name="book" size={17} /><span>Docs</span></a>
        </div>
      </header>

      {token && <nav className="mobile-tools" aria-label="Workspace tools">
        <button className="button quiet mobile-workspace" onClick={() => setPanel("workspace")} disabled={busy}><Icon name="chat" size={16} /> Workspace</button>
        <button className="button quiet mobile-model" onClick={() => setPanel("settings")} disabled={busy}><Icon name="settings" size={16} /> Model</button>
        <button className="button quiet mobile-sources" onClick={() => setPanel("sources")}><Icon name="folder" size={16} /> Sources <span className="count">{sources.length}</span></button>
        {isAdmin && <button className="button quiet mobile-users" onClick={() => setPanel("users")} disabled={busy}><Icon name="users" size={16} /> Users</button>}
      </nav>}

      <div className="thread" ref={thread} onScroll={event => {
        const target = event.currentTarget;
        const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 90;
        followMessages.current = atBottom;
        setShowLatest(!atBottom);
      }}>
        {!messages.length ? <section className="welcome" aria-labelledby="welcome-title">
          <Landscape theme={theme} motionEnabled={motionEnabled} />
          <p className="section-label"><Icon name="spark" size={15} /> Research workspace</p>
          <h2 id="welcome-title">Ask your<br /><em>sources.</em></h2>
          <p className="welcome-description">Find the passages that answer your questions.</p>
          {issue ? <div className="welcome-action">
            <button className="button primary" disabled={busy} onClick={() => setPanel("settings")}><Icon name="settings" size={17} /> Configure model</button>
            <p>{issue}</p>
          </div> : sources.length ? <div className="suggestions">
            {suggestions.map(suggestion => <button className="button secondary" key={suggestion} disabled={busy} onClick={() => {
              setInput(suggestion);
              composer.current?.focus();
            }}><Icon name="chat" size={15} />{suggestion}</button>)}
          </div> : <div className="welcome-action">
            <button className="button primary" onClick={() => setPanel("sources")}><Icon name="plus" size={17} /> Add sources</button>
            <p>Add a document to start asking questions about it.</p>
          </div>}
        </section> : <div className="transcript" role="log" aria-label="Chat messages">
          {messages.map((message, index) => <Message key={`${sessionId}-${index}`} message={message} />)}
          {activity === "answer" && <div className="pending"><span className="spinner" /> Searching sources and preparing an answer…</div>}
        </div>}
      </div>

      {token && <footer className="composer-area">
        <div className="composer-inner">
          {showLatest && messages.length > 0 && <button className="button secondary latest" onClick={scrollToLatest}>Latest messages <Icon name="chevron" size={15} /></button>}
          {panel !== "workspace" && statusNotice}
          <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
            <label htmlFor="question" className="visually-hidden">Your question</label>
            <textarea id="question" ref={composer} rows={2} maxLength={questionLimit} disabled={activity === "answer"}
              value={input} onChange={event => setInput(event.target.value)}
              placeholder={issue ? "Configure a model to send a question" : "Ask a question about your sources…"}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }} />
            <div className="composer-actions">
              <button className="button quiet attach-button" type="button" onClick={() => setPanel("sources")}><Icon name="folder" size={17} /> Sources</button>
              {input.length > questionLimit - 500 && <span className="character-count">{input.length.toLocaleString()} / {questionLimit.toLocaleString()}</span>}
              <button className="button primary send" aria-label="Send question" disabled={!input.trim() || !canUseProviders}><Icon name="send" size={19} /></button>
            </div>
          </form>
          <p className="composer-note">{issue ? <>
            {issue} <button className="text-button" disabled={busy} onClick={() => setPanel("settings")}>Open model settings</button>
          </> : sources.length ? "Enter to send · Shift + Enter for a new line" : "Add a source before asking a document question."}</p>
        </div>
      </footer>}
    </main>

    <aside className="source-rail" aria-label="Sources">
      <div className="rail-heading"><span className="rail-icon"><Icon name="folder" /></span><div><h2>Sources</h2><p>Evidence for this session</p></div></div>
      <SourceLibrary key={sessionId} {...libraryProps} />
    </aside>

    {panel === "workspace" && <Overlay key={panel} title="Workspace" description="Open, create, or disconnect from a session." onDismiss={() => setPanel(null)}>
      {workspaceControls}{statusNotice}
    </Overlay>}
    {panel === "settings" && <Overlay key={panel} title="Model settings" description="Choose your chat model, credentials, and index configuration." onDismiss={() => setPanel(null)}>
      <ModelSettings settings={settings} profile={profile} update={update} issue={issue} disabled={busy}
        canUseServerManagedKeys={Boolean(identity?.can_use_server_managed_keys)}
        serverKeyProviders={identity?.server_key_providers || []} />
      <form className="overlay-footer" method="dialog"><button className="button primary">Done <Icon name="check" size={17} /></button></form>
    </Overlay>}
    {panel === "users" && isAdmin && <Overlay key={panel} title="Users" description="Everyone who has signed up or signed in, with their activity." onDismiss={() => setPanel(null)}>
      <AdminUsers token={token} />
    </Overlay>}
    {panel === "sources" && <Overlay key={panel} title="Sources" description="Add documents and see what is indexed in this session." onDismiss={() => setPanel(null)}>
      <SourceLibrary {...libraryProps} />
    </Overlay>}
    {themeOverlay}
  </div>;
}
