import { useEffect, useState } from "react";
import { adminUsers } from "./api";
import { Icon } from "./Icons";
import type { AdminReport } from "./types";

const methodLabel = { guest: "Guest", email: "Email", google: "Google" } as const;

function when(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AdminUsers({ token }: { token: string }) {
  const [report, setReport] = useState<AdminReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setReport(await adminUsers(token));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [token]);

  const query = filter.trim().toLowerCase();
  const users = (report?.users || []).filter(user => !query ||
    [user.name, user.email, user.method].some(value => value?.toLowerCase().includes(query)));
  const summary = report?.summary;

  return <div className="admin-users">
    {summary && <div className="admin-stats">
      <div><strong>{summary.total_users}</strong><span>Registered users</span></div>
      <div><strong>{summary.total_logins}</strong><span>Total sign-ins</span></div>
      <div><strong>{summary.active_last_24h}</strong><span>Active in 24h</span></div>
      <div><strong>{summary.new_last_7d}</strong><span>New this week</span></div>
    </div>}
    {summary && <p className="muted">By method: {summary.email} email · {summary.google} Google · {summary.guests} guest</p>}

    <div className="admin-toolbar">
      <input aria-label="Filter users" placeholder="Filter by name, email, or method" value={filter} onChange={event => setFilter(event.target.value)} />
      <button className="button secondary" onClick={() => void load()} disabled={loading}>
        {loading ? <span className="spinner" /> : <Icon name="check" size={16} />} Refresh
      </button>
    </div>

    {error && <p className="notice error" role="status"><Icon name="info" size={17} />{error}</p>}
    {!error && report && !users.length && <p className="muted">{query ? "No users match this filter." : "No users have signed up yet."}</p>}
    {users.length > 0 && <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>User</th><th>Method</th><th>Joined</th><th>Last sign-in</th><th>Sign-ins</th><th>Sessions</th></tr></thead>
        <tbody>
          {users.map(user => <tr key={user.id}>
            <td><strong>{user.name || "Guest"}</strong><small>{user.email || user.id.slice(0, 8)}</small></td>
            <td><span className={`method ${user.method}`}>{methodLabel[user.method]}</span></td>
            <td>{when(user.created_at)}</td>
            <td>{when(user.last_login_at)}</td>
            <td>{user.login_count}</td>
            <td>{user.sessions}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </div>;
}
