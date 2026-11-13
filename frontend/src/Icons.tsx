import type { ReactNode } from "react";

const drawings = {
  mark: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  chat: <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.5-3.2a7.5 7.5 0 1 1 13.5-4.3Z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>,
  file: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/></>,
  book: <><path d="M4 5h6a2 2 0 0 1 2 2v13a3 3 0 0 0-3-3H4V5Zm16 0h-6a2 2 0 0 0-2 2v13a3 3 0 0 1 3-3h5V5Z"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4m8 2v4m-6 2v4" strokeWidth="3"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  send: <path d="M12 19V5M6 11l6-6 6 6"/>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  logout: <><path d="M10 20H5V4h5m4 4 4 4-4 4m4-4H9"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  link: <><path d="m10 13 4-4m-6 5-1 1a3.5 3.5 0 0 0 5 5l3-3a3.5 3.5 0 0 0 0-5m1-2 1-1a3.5 3.5 0 0 0-5-5L9 7a3.5 3.5 0 0 0 0 5"/></>,
  spark: <path d="M12 2c.8 6.4 3.6 9.2 10 10-6.4.8-9.2 3.6-10 10-.8-6.4-3.6-9.2-10-10 6.4-.8 9.2-3.6 10-10Z"/>,
  users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7m2.5 8.5A6.5 6.5 0 0 0 16 14.8"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1 1 0 0 1 .7-1.7H17a4 4 0 0 0 4-4A9 9 0 0 0 12 3Z"/><path d="M8 8h.01M14 7h.01M17 11h.01M7 13h.01" strokeWidth="2.5"/></>,
} satisfies Record<string, ReactNode>;

export function Icon({ name, size = 18 }: { name: keyof typeof drawings; size?: number }) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{drawings[name]}</svg>;
}
