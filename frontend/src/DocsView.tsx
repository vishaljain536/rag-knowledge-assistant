import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import overview from "../../README.md?raw";
import changelog from "../../CHANGELOG.md?raw";
import walkthrough from "../../CODE_WALKTHROUGH.md?raw";
import deployment from "../../DEPLOYMENT.md?raw";
import guide from "../../PROJECT_GUIDE.md?raw";
import { Icon } from "./Icons";

const documents = [
  { id: "overview", file: "README.md", label: "Overview", text: overview },
  { id: "changelog", file: "CHANGELOG.md", label: "Changelog", text: changelog },
  { id: "code-walkthrough", file: "CODE_WALKTHROUGH.md", label: "Code walkthrough", text: walkthrough },
  { id: "deployment", file: "DEPLOYMENT.md", label: "Deployment", text: deployment },
  { id: "project-guide", file: "PROJECT_GUIDE.md", label: "Project guide", text: guide },
];

const repository = "https://github.com/vishaljain536/rag-knowledge-assistant/blob/master/";

function slug(heading: string) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
}

function docLink(href: string, current: string) {
  if (href.startsWith("https://") || href.startsWith("http://")) return href;
  const [file, section] = href.replace(/^\.\//, "").split("#");
  const target = documents.find(doc => doc.file === file);
  if (target || !file) return `#docs/${target?.id || current}${section ? "/" + section : ""}`;
  return repository + href;
}

export default function DocsView({ hash, themeControl }: { hash: string; themeControl: ReactNode }) {
  const [, id, section] = hash.slice(1).split("/");
  const doc = documents.find(entry => entry.id === id) || documents[0];
  const body = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = `${doc.label} · Global RAG`;
    body.current?.focus({ preventScroll: true });
    const heading = section && document.getElementById(section);
    if (heading) heading.scrollIntoView();
    else window.scrollTo(0, 0);
    return () => { document.title = "Global RAG Assistant"; };
  }, [doc, section]);

  return <div className="docs-shell">
    <header className="docs-header">
      <a className="brand" href="#" aria-label="Back to workspace">
        <span className="brand-mark"><Icon name="mark" size={22} /></span>
        <span><strong>Global RAG</strong><small>Documentation</small></span>
      </a>
      <div className="masthead-actions">
        {themeControl}
        <a className="button secondary" href="#"><Icon name="chat" size={17} /> Workspace</a>
      </div>
    </header>
    <div className="docs-layout">
      <nav className="docs-nav" aria-label="Documentation">
        <p className="section-label">Documentation</p>
        {documents.map(entry => <a key={entry.id} aria-current={doc.id === entry.id ? "page" : undefined} href={`#docs/${entry.id}`}>
          {entry.label}<Icon name="chevron" size={15} />
        </a>)}
      </nav>
      <main className="doc-content" ref={body} tabIndex={-1}>
        <ReactMarkdown disallowedElements={["img"]} components={{
          h2: ({ children }) => <h2 id={slug(String(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slug(String(children))}>{children}</h3>,
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>;
            const target = docLink(href, doc.id);
            return target.startsWith("#") ? <a href={target}>{children}</a>
              : <a href={target} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}>{doc.text}</ReactMarkdown>
      </main>
    </div>
  </div>;
}
