import { useRef, useState } from "react";
import { Icon } from "./Icons";
import type { Source } from "./types";

const formats = [".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md"];
const mebibyte = 1024 ** 2;
export const urlIngestionEnabled = import.meta.env.VITE_ENABLE_URL_INGESTION === "true";

export function uploadIssue(files: File[]): string | null {
  if (files.length > 8) return "Choose up to 8 files per upload.";
  let total = 0;
  for (const file of files) {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!formats.includes(extension)) return `“${file.name}” is unsupported. Choose a text PDF, DOCX, XLSX, CSV, TXT, or Markdown file.`;
    if (file.size > 25 * mebibyte) return `“${file.name}” exceeds the 25 MiB per-file limit.`;
    if (file.size === 0) return `“${file.name}” is empty.`;
    total += file.size;
  }
  return total > 48 * mebibyte ? "Choose files totaling at most 48 MiB per upload." : null;
}

export type Notice = { tone: "error" | "success"; text: string };

type Props = {
  sources: Source[];
  busy: boolean;
  uploading: boolean;
  disabledReason: string | null;
  notice: Notice | null;
  url: string;
  setUrl: (url: string) => void;
  onFiles: (files: File[]) => void;
  onUrl: () => void;
  onConfigure?: () => void;
};

export function SourceLibrary({ sources, busy, uploading, disabledReason, notice, url, setUrl, onFiles, onUrl, onConfigure }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("");
  const disabled = busy || Boolean(disabledReason);
  const filtered = sources.filter(source => source.label.toLowerCase().includes(filter.trim().toLowerCase()));

  return <div className="source-library">
    <div
      className={`dropzone ${dragging && !disabled ? "dragging" : ""}`}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={event => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!disabled) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <span className="drop-icon"><Icon name="upload" size={19} /></span>
      <strong className="drop-label">Drop files here</strong>
      <strong className="touch-label">Upload documents</strong>
      <p>Text PDF, DOCX, XLSX, CSV, TXT, or Markdown</p>
      <button className="button primary" disabled={disabled} onClick={() => picker.current?.click()}>
        <Icon name="plus" size={16} /> Add files
      </button>
      <input ref={picker} type="file" accept={formats.join(",")} multiple hidden onChange={event => {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        if (files.length && !disabled) onFiles(files);
      }} />
      <small>8 files per upload · 25 MiB per file</small>
    </div>
    {disabledReason && <p className="source-hint">{disabledReason}{onConfigure && <>
      {" "}<button className="text-button" onClick={onConfigure}>Model settings</button>
    </>}</p>}
    {urlIngestionEnabled && <form className="url-form" onSubmit={event => { event.preventDefault(); onUrl(); }}>
      <label>Approved HTTPS webpage
        <input type="url" placeholder="https://example.org/guide" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} />
      </label>
      <button className="button secondary" disabled={disabled || !url.trim()}><Icon name="link" size={16} /> Add URL</button>
    </form>}
    <div role="status" className="source-feedback">
      {uploading ? <p className="notice"><span className="spinner" /> Reading and indexing sources…</p>
        : notice && <p className={`notice ${notice.tone}`}><Icon name={notice.tone === "success" ? "check" : "info"} size={16} />{notice.text}</p>}
    </div>
    <div className="source-list-heading">
      <h3>Indexed sources</h3><span className="count">{sources.length}</span>
    </div>
    {sources.length > 6 && <label className="source-search">
      <span className="visually-hidden">Find a source</span>
      <input type="search" placeholder="Find a source…" value={filter} onChange={event => setFilter(event.target.value)} />
    </label>}
    {filtered.length ? <ul className="source-list">
      {filtered.map(source => <li key={source.id}>
        <span className="file-icon"><Icon name={source.label.startsWith("https://") ? "link" : "file"} size={17} /></span>
        <div><strong title={source.label}>{source.label}</strong><small>{source.chunks} {source.chunks === 1 ? "passage" : "passages"}</small></div>
        <Icon name="check" size={15} />
      </li>)}
    </ul> : <p className="source-hint">{sources.length ? "No sources match that search." : "Files will appear here after indexing."}</p>}
  </div>;
}
