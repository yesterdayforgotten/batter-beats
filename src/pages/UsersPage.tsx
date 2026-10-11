import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { ROLE_LABELS, ROLES, type Role, type User } from "../../shared/types.ts";

export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: User[] }>("/users")
      .then((r) => setUsers(r.users))
      .catch((err) => setError(err.message));
  }, []);

  async function changeRole(user: User, role: Role) {
    setError(null);
    try {
      const r = await api<{ users: User[] }>(`/users/${user.id}`, { method: "PATCH", body: { role } });
      setUsers(r.users);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h1 className="big-title">Users</h1>
      <AddUserForm onAdded={(u) => setUsers((list) => [...list, u].sort(byName))} />
      {error && <p className="error">{error}</p>}
      <ul className="list" style={{ marginTop: 12 }}>
        {users.map((u) => (
          <li key={u.id} className="card user-row">
            <div className="user-name">
              {u.username}
              {u.id === me?.id && <span className="muted"> (you)</span>}
            </div>
            <select value={u.role} onChange={(e) => changeRole(u, e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <ResetPassword user={u} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function byName(a: User, b: User) {
  return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
}

function AddUserForm({ onAdded }: { onAdded(user: User): void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ user: User }>("/users", { body: { username, password, role } });
      onAdded(r.user);
      setUsername("");
      setPassword("");
      setRole("user");
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) {
    return (
      <button className="primary" onClick={() => setOpen(true)}>
        Add user
      </button>
    );
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          required
        />
      </label>
      <label>
        Password
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary">Create user</button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ResetPassword({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: { password } });
      setPassword("");
      setOpen(false);
      setMessage("Password changed.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) {
    return (
      <div className="reset">
        <button
          onClick={() => {
            setOpen(true);
            setMessage(null);
          }}
        >
          Reset password
        </button>
        {message && <span className="ok">{message}</span>}
      </div>
    );
  }

  return (
    <form className="reset stack" onSubmit={handleSubmit}>
      <label>
        New password for {user.username}
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="new-password"
          required
          autoFocus
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary">Save</button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
