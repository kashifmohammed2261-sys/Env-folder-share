import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const EMPTY_PROJECT = { name: "", description: "" };
const EMPTY_VARIABLE = { key: "", value: "", is_sensitive: false };

async function apiRequest(path, token, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { detail: raw }; }
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail.map((x) => x.msg || JSON.stringify(x)).join("; ") : JSON.stringify(data.detail || data);
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return data;
}

function readStoredUser() {
  try { return JSON.parse(localStorage.getItem("envshare_user") || "null"); }
  catch { return null; }
}

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    folder: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M3.5 10h17" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 7-7 3 3-2 2 2 2-3 3-2-2" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" /><path d="m9 12 2 2 4-4" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    edit: <><path d="m15 5 4 4" /><path d="M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m-10 0 1 14h10l1-14M10 10v6m4-6v6" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    sparkles: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3z" /><path d="m19 14 1.1 2.1L22 17l-1.9.9L19 20l-.9-2.1L16 17l2.1-.9z" /></>,
    server: <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3" /></>,
    terminal: <><path d="m4 7 5 5-5 5M12 17h8" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.sparkles}</svg>;
}

function Wallpaper() {
  return <div className="live-wallpaper" aria-hidden="true">
    <div className="wallpaper-grid" />
    <div className="wallpaper-orb orb-violet" />
    <div className="wallpaper-orb orb-gold" />
    <div className="wallpaper-orb orb-mint" />
    <div className="wallpaper-stars" />
    <div className="wallpaper-scanline" />
  </div>;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const bad = toast.type === "error";
  return <div className={`toast ${bad ? "toast-error" : "toast-success"}`} role="status">
    <span className="toast-icon"><Icon name={bad ? "close" : "check"} size={16} /></span>
    <span>{toast.message}</span>
    <button className="toast-close" onClick={onClose} aria-label="Dismiss notification"><Icon name="close" size={15} /></button>
  </div>;
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-topline"><span className="modal-emblem"><Icon name="sparkles" size={19} /></span><button className="icon-button" onClick={onClose} aria-label="Close modal"><Icon name="close" /></button></div>
      <p className="eyebrow">ENVS HARE WORKSPACE</p>
      <h2>{title}</h2>
      {subtitle && <p className="modal-subtitle">{subtitle}</p>}
      {children}
    </section>
  </div>;
}

function EmptyState({ icon = "folder", title, description, action }) {
  return <div className="empty-state">
    <div className="empty-icon"><Icon name={icon} size={23} /></div>
    <h3>{title}</h3>
    <p>{description}</p>
    {action}
  </div>;
}

function StatCard({ icon, label, value, hint, color = "violet" }) {
  return <article className={`stat-card stat-${color}`}>
    <div className="stat-top"><span className="stat-icon"><Icon name={icon} /></span><span className="stat-label">{label}</span></div>
    <strong className="stat-value">{value}</strong>
    <span className="stat-hint">{hint}</span>
  </article>;
}

function VariableTable({ variables, onEdit, onDelete }) {
  if (!variables.length) return <EmptyState icon="key" title="No variables yet" description="Add your first configuration key to this environment." />;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>VARIABLE KEY</th><th>VALUE</th><th>TYPE</th><th>LAST UPDATED</th><th className="align-right">ACTIONS</th></tr></thead>
    <tbody>{variables.map((variable) => <tr key={variable.id}>
      <td><div className="key-cell"><span className="key-bullet" /><code>{variable.key}</code></div></td>
      <td><div className="value-cell"><code>{variable.is_sensitive ? "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" : variable.value}</code>{variable.is_sensitive && <span className="value-lock"><Icon name="lock" size={12} /></span>}</div></td>
      <td><span className={`type-pill ${variable.is_sensitive ? "type-secret" : "type-standard"}`}><span />{variable.is_sensitive ? "Sensitive" : "Standard"}</span></td>
      <td className="date-cell">{variable.updated_at || "â€”"}</td>
      <td><div className="table-actions"><button className="table-action" onClick={() => onEdit(variable)} title="Edit variable"><Icon name="edit" size={15} /></button><button className="table-action action-danger" onClick={() => onDelete(variable)} title="Delete variable"><Icon name="trash" size={15} /></button></div></td>
    </tr>)}</tbody></table></div>;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("envshare_token") || "");
  const [user, setUser] = useState(readStoredUser);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [projectDetail, setProjectDetail] = useState(null);
  const [environments, setEnvironments] = useState([]);
  const [environmentId, setEnvironmentId] = useState("");
  const [variables, setVariables] = useState([]);
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState("overview");
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [modal, setModal] = useState("");
  const [projectForm, setProjectForm] = useState({ ...EMPTY_PROJECT });
  const [environmentName, setEnvironmentName] = useState("Development");
  const [variableForm, setVariableForm] = useState({ ...EMPTY_VARIABLE });
  const [editForm, setEditForm] = useState(null);
  const [importContent, setImportContent] = useState("# Paste environment variables here\nAPP_MODE=development\nDATABASE_HOST=localhost\n");
  const [importPreview, setImportPreview] = useState(null);
  const [memberForm, setMemberForm] = useState({ email: "", permission: "viewer" });
  const [mobileNav, setMobileNav] = useState(false);

  const notify = useCallback((message, type = "success") => {
    setToast({ message, type });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 4600);
  }, []);

  const selectedProject = projects.find((project) => String(project.id) === String(projectId));
  const selectedEnvironment = environments.find((environment) => String(environment.id) === String(environmentId));
  const currentPermission = projectDetail?.current_permission || selectedProject?.current_permission || "viewer";
  const canEdit = currentPermission === "owner" || currentPermission === "editor";
  const isOwner = currentPermission === "owner";
  const sensitiveCount = variables.filter((item) => item.is_sensitive).length;
  const filteredVariables = useMemo(() => variables.filter((item) => {
    const matchesSearch = `${item.key} ${item.is_sensitive ? "sensitive" : "standard"}`.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || (typeFilter === "sensitive" ? item.is_sensitive : !item.is_sensitive);
    return matchesSearch && matchesType;
  }), [variables, search, typeFilter]);

  const logout = useCallback(() => {
    localStorage.removeItem("envshare_token");
    localStorage.removeItem("envshare_user");
    setToken(""); setUser(null); setProjects([]); setProjectId(""); setProjectDetail(null);
    setEnvironments([]); setEnvironmentId(""); setVariables([]); setHistory([]); setPage("overview");
    setToast(null);
  }, []);

  const loadProjects = useCallback(async (authToken = token) => {
    if (!authToken) return;
    const data = await apiRequest("/api/projects", authToken);
    const list = data.projects || [];
    setProjects(list);
    setProjectId((previous) => list.some((item) => String(item.id) === String(previous)) ? previous : (list.length ? String(list[0].id) : ""));
    return list;
  }, [token]);

  const loadVariables = useCallback(async (envId = environmentId) => {
    if (!token || !envId) { setVariables([]); return []; }
    const data = await apiRequest(`/api/environments/${envId}/variables`, token);
    setVariables(data.variables || []);
    return data.variables || [];
  }, [token, environmentId]);

  const loadHistory = useCallback(async (projId = projectId) => {
    if (!projId) { setHistory([]); return; }
    const data = await apiRequest(`/api/projects/${projId}/history`, token);
    setHistory(data.history || []);
    return data.history || [];
  }, [projectId, token]);

  const loadProjectDetail = useCallback(async (projId = projectId) => {
    if (!projId) { setProjectDetail(null); return; }
    const data = await apiRequest(`/api/projects/${projId}`, token);
    setProjectDetail(data);
    return data;
  }, [projectId, token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try { await loadProjects(token); }
      catch (error) { if (active) { notify(error.message, "error"); if (/token|login/i.test(error.message)) logout(); } }
    })();
    return () => { active = false; };
  }, [token, loadProjects, logout, notify]);

  useEffect(() => {
    if (!token || !projectId) {
      setEnvironments([]); setEnvironmentId(""); setProjectDetail(null); setVariables([]); setHistory([]); return;
    }
    let active = true;
    (async () => {
      try {
        const [envData, detail] = await Promise.all([
          apiRequest(`/api/projects/${projectId}/environments`, token),
          apiRequest(`/api/projects/${projectId}`, token),
        ]);
        if (!active) return;
        const envList = envData.environments || [];
        setEnvironments(envList); setProjectDetail(detail);
        setEnvironmentId((previous) => envList.some((item) => String(item.id) === String(previous)) ? previous : (envList.length ? String(envList[0].id) : ""));
      } catch (error) { if (active) notify(error.message, "error"); }
    })();
    return () => { active = false; };
  }, [token, projectId, notify]);

  useEffect(() => {
    if (!token || !environmentId) { setVariables([]); return; }
    let active = true;
    apiRequest(`/api/environments/${environmentId}/variables`, token)
      .then((data) => { if (active) setVariables(data.variables || []); })
      .catch((error) => { if (active) notify(error.message, "error"); });
    return () => { active = false; };
  }, [token, environmentId, notify]);

  useEffect(() => {
    if (page === "history" && token && projectId) loadHistory().catch((error) => notify(error.message, "error"));
  }, [page, token, projectId, loadHistory, notify]);

  useEffect(() => {
    if (page === "team" && token && projectId) loadProjectDetail().catch((error) => notify(error.message, "error"));
  }, [page, token, projectId, loadProjectDetail, notify]);

  async function authenticate(event) {
    event.preventDefault(); setAuthLoading(true);
    try {
      if (authMode === "register") {
        await apiRequest("/api/auth/register", "", { method: "POST", body: JSON.stringify(authForm) });
        setAuthMode("login"); setAuthForm((previous) => ({ ...previous, password: "" }));
        notify("Account created. Sign in to continue.");
        return;
      }
      const body = new URLSearchParams(); body.set("username", authForm.email); body.set("password", authForm.password);
      const response = await fetch(`${API_BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Unable to sign in.");
      localStorage.setItem("envshare_token", data.access_token);
      localStorage.setItem("envshare_user", JSON.stringify(data.user));
      setUser(data.user); setToken(data.access_token); setPage("overview"); notify("Welcome back to EnvShare.");
    } catch (error) { notify(error.message, "error"); }
    finally { setAuthLoading(false); }
  }

  async function createProject(event) {
    event.preventDefault(); setBusy(true);
    try {
      const data = await apiRequest("/api/projects", token, { method: "POST", body: JSON.stringify(projectForm) });
      await loadProjects(token);
      setProjects((previous) => [data.project, ...previous.filter((item) => item.id !== data.project.id)]);
      setProjectId(String(data.project.id)); setProjectForm({ ...EMPTY_PROJECT }); setModal(""); setPage("overview");
      notify("Project created successfully.");
    } catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }

  async function createEnvironment(event) {
    event.preventDefault(); if (!projectId) return;
    setBusy(true);
    try {
      const data = await apiRequest(`/api/projects/${projectId}/environments`, token, { method: "POST", body: JSON.stringify({ name: environmentName }) });
      const newEnvironment = data.environment;
      setEnvironments((previous) => [...previous.filter((item) => item.id !== newEnvironment.id), newEnvironment]);
      setEnvironmentId(String(newEnvironment.id)); setEnvironmentName("Development"); setModal("");
      notify("Environment created successfully.");
    } catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }

  async function createVariable(event) {
    event.preventDefault(); if (!environmentId) return;
    setBusy(true);
    try {
      await apiRequest(`/api/environments/${environmentId}/variables`, token, { method: "POST", body: JSON.stringify(variableForm) });
      await loadVariables(environmentId); setVariableForm({ ...EMPTY_VARIABLE }); setModal("");
      notify("Variable created successfully.");
    } catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }

  function startEdit(variable) {
    setEditForm({ id: variable.id, originalSensitive: Boolean(variable.is_sensitive), key: variable.key, value: variable.is_sensitive ? "" : (variable.value || ""), is_sensitive: Boolean(variable.is_sensitive) });
    setModal("editVariable");
  }

  async function saveVariableEdit(event) {
    event.preventDefault(); if (!editForm || !environmentId) return;
    setBusy(true);
    const body = { key: editForm.key, is_sensitive: editForm.is_sensitive };
    // The API intentionally masks sensitive values. Omit an empty value to preserve the stored secret.
    if (!(editForm.originalSensitive && editForm.value === "")) body.value = editForm.value;
    try {
      await apiRequest(`/api/environments/${environmentId}/variables/${editForm.id}`, token, { method: "PUT", body: JSON.stringify(body) });
      await loadVariables(environmentId); setModal(""); setEditForm(null); notify("Variable updated successfully.");
    } catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }

  async function deleteVariable(variable) {
    const accepted = window.confirm(`Delete â€œ${variable.key}â€ permanently?`);
    if (!accepted) return;
    try {
      await apiRequest(`/api/environments/${environmentId}/variables/${variable.id}`, token, { method: "DELETE" });
      setVariables((previous) => previous.filter((item) => item.id !== variable.id));
      notify("Variable deleted successfully.");
    } catch (error) { notify(error.message, "error"); }
  }

  async function handleImport(mode) {
    if (!environmentId) { notify("Choose an environment first.", "error"); return; }
    setBusy(true);
    try {
      const endpoint = mode === "apply" ? "import-apply" : "import-preview";
      const data = await apiRequest(`/api/environments/${environmentId}/${endpoint}`, token, { method: "POST", body: JSON.stringify({ content: importContent }) });
      setImportPreview({ ...data, mode });
      if (mode === "apply") {
        await loadVariables(environmentId);
        notify(`Import applied: ${data.created ?? 0} created, ${data.updated ?? 0} updated, ${data.unchanged ?? 0} unchanged.`);
      } else notify("Preview ready. Review the summary before applying.");
    } catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }

  async function refreshProject() {
    try { await Promise.all([loadProjects(), loadProjectDetail(), environmentId ? loadVariables(environmentId) : Promise.resolve()]); notify("Workspace refreshed."); }
    catch (error) { notify(error.message, "error"); }
  }

  async function addMember(event) {
    event.preventDefault(); if (!projectId) return;
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${projectId}/members`, token, { method: "POST", body: JSON.stringify(memberForm) });
      const detail = await loadProjectDetail(projectId);
      setProjectDetail(detail); setMemberForm({ email: "", permission: "viewer" });
      notify("Team access saved successfully.");
    } catch (error) { notify(error.message, "error"); }
    finally { setBusy(false); }
  }

  const navigate = (target) => { setPage(target); setMobileNav(false); };
  const pageTitles = { overview: ["WORKSPACE", "Your workspace"], variables: ["CONFIGURATION", "Environment variables"], import: ["SMART CONFIGURATION", "Import .env"], history: ["AUDIT TRAIL", "Change history"], team: ["COLLABORATION", "Team access"] };
  const title = pageTitles[page] || pageTitles.overview;

  if (!token) {
    return <div className="app-root auth-root"><Wallpaper /><Toast toast={toast} onClose={() => setToast(null)} /><main className="auth-layout">
      <div className="auth-story"><div className="auth-brand"><span className="brand-mark"><Icon name="shield" size={22} /></span><div><strong>EnvShare</strong><small>SECURE CONFIGURATION CLOUD</small></div></div>
        <div className="story-copy"><span className="story-kicker"><i /> PRIVATE BY DESIGN</span><h1>Every secret.<br /><span>In its right place.</span></h1><p>A calm, secure workspace for your team's environments, configuration and change history.</p>
          <div className="story-proof"><span><Icon name="lock" size={16} /> Encrypted secrets</span><span><Icon name="history" size={16} /> Audit trail</span><span><Icon name="users" size={16} /> Team-ready</span></div></div>
        <div className="auth-copyright">ENVS HARE Â© {new Date().getFullYear()} <span>BUILT FOR TEAMS THAT SHIP</span></div></div>
      <section className="auth-card"><div className="auth-card-top"><span className="secure-mark"><Icon name="shield" size={17} /></span><span className="secure-caption">SECURE WORKSPACE ACCESS</span><span className="auth-live"><i /> LIVE</span></div>
        <p className="eyebrow">{authMode === "login" ? "WELCOME BACK" : "GET STARTED"}</p><h2>{authMode === "login" ? "Sign in to EnvShare" : "Create your account"}</h2><p className="auth-description">{authMode === "login" ? "Your team's configuration hub is one step away." : "Join your team in a secure configuration workspace."}</p>
        <form onSubmit={authenticate} className="auth-form">
          {authMode === "register" && <label>FULL NAME<input required minLength={2} autoComplete="name" placeholder="How should we call you?" value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} /></label>}
          <label>EMAIL ADDRESS<input required type="email" autoComplete="email" placeholder="you@company.com" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} /></label>
          <label>PASSWORD<input required minLength={8} type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} placeholder="At least 8 characters" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} /></label>
          <button className="primary-button full-button" disabled={authLoading}>{authLoading ? "Please waitâ€¦" : authMode === "login" ? <>Enter workspace <Icon name="arrow" size={16} /></> : <>Create account <Icon name="arrow" size={16} /></>}</button>
        </form>
        <div className="auth-switch">{authMode === "login" ? "New to EnvShare?" : "Already have access?"}<button className="text-button" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setToast(null); }}> {authMode === "login" ? "Create account" : "Sign in"}</button></div>
        <div className="auth-assurance"><Icon name="lock" size={13} /><span>Your credentials are protected with secure authentication.</span></div>
      </section></main></div>;
  }

  return <div className="app-root"><Wallpaper /><Toast toast={toast} onClose={() => setToast(null)} /><div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="sidebar-brand"><span className="brand-mark"><Icon name="shield" size={21} /></span><div className="brand-word"><strong>Env<span>Share</span></strong><small>CONFIGURATION CLOUD</small></div><button className="mobile-close icon-button" onClick={() => setMobileNav(false)}><Icon name="close" /></button></div>
      <div className="workspace-switcher"><div className="workspace-avatar">{(user?.name || user?.email || "E").slice(0, 1).toUpperCase()}</div><div className="workspace-meta"><span>WORKSPACE</span><strong>{user?.name || "My workspace"}</strong></div><span className="workspace-chevron"><Icon name="chevron" size={15} /></span></div>
      <p className="sidebar-label">WORKSPACE</p>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={`nav-item ${page === "overview" ? "active" : ""}`} onClick={() => navigate("overview")}><Icon name="grid" /><span>Overview</span></button>
        <button className={`nav-item ${page === "variables" ? "active" : ""}`} onClick={() => navigate("variables")}><Icon name="key" /><span>Variables</span><span className="nav-count">{variables.length}</span></button>
        <button className={`nav-item ${page === "import" ? "active" : ""}`} onClick={() => navigate("import")}><Icon name="upload" /><span>Smart import</span></button>
        <button className={`nav-item ${page === "history" ? "active" : ""}`} onClick={() => navigate("history")}><Icon name="history" /><span>Change history</span></button>
        <button className={`nav-item ${page === "team" ? "active" : ""}`} onClick={() => navigate("team")}><Icon name="users" /><span>Team access</span></button>
      </nav>
      <div className="sidebar-section-head"><p className="sidebar-label">YOUR PROJECTS</p><button className="add-project-icon" title="Create project" onClick={() => { setProjectForm({ ...EMPTY_PROJECT }); setModal("project"); }}><Icon name="plus" size={15} /></button></div>
      <div className="project-list">{projects.map((project) => <button key={project.id} className={`project-item ${String(project.id) === String(projectId) ? "selected" : ""}`} onClick={() => { setProjectId(String(project.id)); setMobileNav(false); }}><span className="project-glyph"><Icon name="folder" size={15} /></span><span className="project-name">{project.name}</span>{String(project.id) === String(projectId) && <span className="selected-dot" />}</button>)}
        {!projects.length && <div className="project-empty">Your first project starts here.</div>}</div>
      <button className="sidebar-create" onClick={() => { setProjectForm({ ...EMPTY_PROJECT }); setModal("project"); }}><Icon name="plus" size={15} /> New project</button>
      <div className="environment-section"><div className="environment-head"><p className="sidebar-label">ENVIRONMENTS</p><button className="add-project-icon" title="Create environment" disabled={!projectId || !canEdit} onClick={() => { setEnvironmentName("Development"); setModal("environment"); }}><Icon name="plus" size={14} /></button></div>
        {environments.map((environment) => <button key={environment.id} className={`environment-item ${String(environment.id) === String(environmentId) ? "environment-active" : ""}`} onClick={() => { setEnvironmentId(String(environment.id)); setMobileNav(false); }}><span className={`env-status env-${environment.name.toLowerCase() === "production" ? "prod" : environment.name.toLowerCase() === "staging" ? "stage" : "dev"}`} /><span>{environment.name}</span></button>)}
        {!environments.length && <div className="project-empty">No environments yet.</div>}</div>
      <div className="sidebar-bottom"><div className="avatar">{(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}</div><div className="user-meta">
  <strong>{user?.name || "Team member"}</strong>
  <small>{user?.email}</small>
  {user?.role === "admin" && (
    <span className="admin-profile-badge">✦ ADMINISTRATOR</span>
  )}
</div><button className="logout-button" onClick={logout} title="Sign out"><Icon name="logout" size={16} /></button></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="main-panel">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Icon name="menu" /></button><div className="breadcrumb"><span>Workspace</span><span className="crumb-divider">/</span><strong>{selectedProject?.name || "Projects"}</strong>{selectedEnvironment && <><span className="crumb-divider">/</span><span>{selectedEnvironment.name}</span></>}</div></div>
        <div className="topbar-actions"><div className="api-status"><span className="api-status-dot" /><span>Workspace online</span></div><button className="icon-button refresh-button" title="Refresh workspace" onClick={() => refreshProject().catch((error) => notify(error.message, "error"))}><Icon name="refresh" size={16} /></button><span className="topbar-divider" /><div className="topbar-user"><span className="topbar-avatar">{(user?.name || user?.email || "U").slice(0, 1).toUpperCase()}</span><span>{user?.name || "Account"}</span></div></div></header>
      <div className="content">
        {page === "overview" && <>
          <section className="hero-row"><div><div className="eyebrow-line"><span className="eyebrow-dot" /> YOUR SECURE WORKSPACE</div><h1>{selectedProject ? selectedProject.name : "Welcome to EnvShare"}<span className="heading-period">.</span></h1><p className="page-subtitle">Everything your team needs to manage configuration with confidence.</p></div><div className="hero-actions"><span className="secure-badge"><Icon name="shield" size={14} /> Secure workspace</span><button className="primary-button" onClick={() => { setVariableForm({ ...EMPTY_VARIABLE }); setModal("variable"); }} disabled={!environmentId || !canEdit}><Icon name="plus" size={16} /> New variable</button></div></section>
          {!projects.length ? <section className="panel onboarding-panel"><div className="onboarding-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-lock"><Icon name="shield" size={31} /></div></div><p className="eyebrow">A BETTER WAY TO SHIP</p><h2>Build your first secure workspace.</h2><p className="muted">Create a project to organize environments, protect sensitive values and keep every change traceable.</p><button className="primary-button" onClick={() => { setProjectForm({ ...EMPTY_PROJECT }); setModal("project"); }}><Icon name="plus" size={16} /> Create your first project</button></section> : <>
            <div className="stats-grid"><StatCard icon="folder" label="PROJECTS" value={projects.length} hint="Projects you can access" color="gold" /><StatCard icon="server" label="ENVIRONMENTS" value={environments.length} hint={selectedProject ? `In ${selectedProject.name}` : "Across your workspace"} color="violet" /><StatCard icon="key" label="VARIABLES" value={variables.length} hint={`${sensitiveCount} sensitive value${sensitiveCount === 1 ? "" : "s"}`} color="mint" /><StatCard icon="history" label="CHANGE TRACKING" value="Live" hint="Project activity is recorded" color="navy" /></div>
            <section className="panel environment-panel"><div className="section-heading"><div><p className="eyebrow">SELECTED ENVIRONMENT</p><h2>Configuration space</h2><p className="muted">Switch environments to view the settings for each stage.</p></div><button className="secondary-button" onClick={() => { setEnvironmentName("Development"); setModal("environment"); }} disabled={!projectId || !canEdit}><Icon name="plus" size={15} /> Add environment</button></div>
              {environments.length ? <div className="environment-switcher">{environments.map((env) => <button key={env.id} className={`environment-card ${String(env.id) === String(environmentId) ? "environment-card-active" : ""}`} onClick={() => setEnvironmentId(String(env.id))}><span className={`env-icon env-${env.name.toLowerCase() === "production" ? "prod" : env.name.toLowerCase() === "staging" ? "stage" : "dev"}`}><Icon name="server" size={18} /></span><span className="environment-card-text"><strong>{env.name}</strong><small>{String(env.id) === String(environmentId) ? "Currently selected" : "View environment"}</small></span>{String(env.id) === String(environmentId) && <span className="environment-check"><Icon name="check" size={14} /></span>}</button>)}</div> : <EmptyState icon="server" title="No environments created" description="Start with Development, then add Staging or Production when you're ready." action={<button className="primary-button" onClick={() => { setEnvironmentName("Development"); setModal("environment"); }}><Icon name="plus" size={15} /> Create environment</button>} />}
            </section>
            <section className="panel"><div className="section-heading"><div><p className="eyebrow">LIVE CONFIGURATION</p><h2>Environment variables</h2><p className="muted">A clear view of the keys powering your app.</p></div><button className="secondary-button" onClick={() => setPage("variables")}>View all <Icon name="arrow" size={14} /></button></div><VariableTable variables={variables.slice(0, 5)} onEdit={startEdit} onDelete={deleteVariable} /></section>
            <section className="feature-strip"><div className="feature-icon violet-feature"><Icon name="lock" size={19} /></div><div><strong>Your sensitive values stay protected.</strong><p>Secrets are encrypted on the backend and masked in standard variable listings.</p></div><span className="feature-shield"><Icon name="shield" size={24} /></span></section>
          </>}
        </>}

        {page === "variables" && <><section className="hero-row"><div><div className="eyebrow-line"><span className="eyebrow-dot" /> KEY-VALUE REGISTRY</div><h1>Variables<span className="heading-period">.</span></h1><p className="page-subtitle">Keep every key tidy, every secret protected and every edit traceable.</p></div><button className="primary-button" onClick={() => { setVariableForm({ ...EMPTY_VARIABLE }); setModal("variable"); }} disabled={!environmentId || !canEdit}><Icon name="plus" size={16} /> New variable</button></section>
          <section className="panel"><div className="toolbar"><div className="toolbar-search"><Icon name="search" size={17} /><input aria-label="Search variables" placeholder="Search keysâ€¦" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="toolbar-controls"><select aria-label="Filter variable type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="standard">Standard</option><option value="sensitive">Sensitive</option></select><span className="count-badge">{filteredVariables.length} keys</span></div></div><VariableTable variables={filteredVariables} onEdit={startEdit} onDelete={deleteVariable} /></section>
          <section className="inline-security-note"><Icon name="shield" size={18} /><span><strong>Security note</strong> Sensitive values are returned masked by the API. Editing a secret without entering a new value will preserve the stored secret.</span></section>
        </>}

        {page === "import" && <><section className="hero-row"><div><div className="eyebrow-line"><span className="eyebrow-dot" /> BULK CONFIGURATION</div><h1>Smart import<span className="heading-period">.</span></h1><p className="page-subtitle">Paste your .env file, review changes, then apply them with confidence.</p></div><span className="secure-badge"><Icon name="shield" size={14} /> Review before saving</span></section>
          {!environmentId ? <section className="panel"><EmptyState icon="server" title="Choose an environment" description="Select or create an environment before importing variables." /></section> : <><section className="panel import-panel"><div className="section-heading"><div><p className="eyebrow">SOURCE CONTENT</p><h2>Paste .env configuration</h2><p className="muted">Blank lines and comments are ignored. Use one KEY=VALUE pair per line.</p></div><span className="editor-language"><span /> DOTENV</span></div><div className="editor-shell"><div className="editor-topbar"><div className="editor-lights"><i /><i /><i /></div><span>{selectedEnvironment?.name || "environment"}.env</span><span className="editor-lock"><Icon name="lock" size={12} /> Local preview</span></div><textarea className="code-editor" spellCheck="false" value={importContent} onChange={(event) => { setImportContent(event.target.value); setImportPreview(null); }} aria-label=".env content" /><div className="editor-footer"><span>{importContent.split("\n").length} lines</span><span>UTF-8 <b>Â·</b> LF</span></div></div><div className="import-actions"><span className="import-hint"><Icon name="shield" size={14} /> Sensitive values are not displayed in the result summary.</span><div><button className="secondary-button" disabled={busy} onClick={() => handleImport("preview")}><Icon name="eye" size={15} /> Preview changes</button><button className="primary-button" disabled={busy} onClick={() => handleImport("apply")}><Icon name="check" size={15} />{busy ? "Processingâ€¦" : "Apply import"}</button></div></div></section>
            {importPreview && <section className="panel result-panel"><div className="section-heading"><div><p className="eyebrow">IMPORT SUMMARY</p><h2>{importPreview.mode === "apply" ? "Import completed" : "Review before applying"}</h2></div><span className={`result-pill ${importPreview.mode === "apply" ? "result-good" : "result-preview"}`}><Icon name={importPreview.mode === "apply" ? "check" : "eye"} size={14} />{importPreview.mode === "apply" ? "APPLIED" : "PREVIEW ONLY"}</span></div>
              <div className="import-result-grid">{importPreview.summary ? <><ResultCount label="New keys" value={importPreview.summary.new} color="mint" /><ResultCount label="Updates" value={importPreview.summary.updates} color="gold" /><ResultCount label="Unchanged" value={importPreview.summary.unchanged} color="violet" /><ResultCount label="Errors" value={importPreview.summary.errors} color="red" /></> : <><ResultCount label="Created" value={importPreview.created ?? 0} color="mint" /><ResultCount label="Updated" value={importPreview.updated ?? 0} color="gold" /><ResultCount label="Unchanged" value={importPreview.unchanged ?? 0} color="violet" /></>}</div>
              {importPreview.errors?.length > 0 && <div className="import-errors"><strong>Resolve these lines before applying</strong>{importPreview.errors.map((item, index) => <p key={index}>Line {item.line}: {item.message}</p>)}</div>}
              {importPreview.mode === "preview" && !importPreview.errors?.length && <div className="preview-apply-row"><span>Review the counts above. Values are intentionally omitted from this summary.</span><button className="primary-button" disabled={busy} onClick={() => handleImport("apply")}>Apply these changes <Icon name="arrow" size={15} /></button></div>}
            </section>}</>}
        </>}

        {page === "history" && <><section className="hero-row"><div><div className="eyebrow-line"><span className="eyebrow-dot" /> AUDIT TRAIL</div><h1>Change history<span className="heading-period">.</span></h1><p className="page-subtitle">An accountable timeline of what changed, who changed it and when.</p></div><button className="secondary-button" onClick={() => loadHistory().catch((error) => notify(error.message, "error"))}><Icon name="refresh" size={15} /> Refresh history</button></section><section className="panel history-panel"><div className="section-heading"><div><p className="eyebrow">PROJECT ACTIVITY</p><h2>{selectedProject?.name || "Selected project"}</h2></div><span className="count-badge">{history.length} events</span></div>{history.length ? <div className="timeline">{history.map((item) => <article className="timeline-item" key={item.id}><div className="timeline-rail"><span className="timeline-node"><Icon name={item.action.includes("delete") ? "trash" : item.action.includes("created") ? "plus" : "edit"} size={13} /></span></div><div className="timeline-card"><div className="timeline-card-top"><span className="timeline-action">{String(item.action || "activity").replaceAll("_", " ")}</span><time>{item.created_at}</time></div><p>{item.details}</p><div className="timeline-actor"><span className="actor-avatar">{(item.changed_by || "U").slice(0, 1).toUpperCase()}</span><span>{item.changed_by || `User ${item.user_id ?? "unknown"}`}</span><span className="actor-dot" /><span>Project activity</span></div></div></article>)}</div> : <EmptyState icon="history" title="Nothing on the timeline yet" description="Project, environment and variable changes will appear here." />}</section></>}

        {page === "team" && <><section className="hero-row"><div><div className="eyebrow-line"><span className="eyebrow-dot" /> COLLABORATION</div><h1>Team access<span className="heading-period">.</span></h1><p className="page-subtitle">Give the right people the right level of access to this project.</p></div><span className="secure-badge"><Icon name="shield" size={14} /> Permission-controlled</span></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">PROJECT MEMBERS</p><h2>People with access</h2><p className="muted">Only the project owner can invite registered users or change their access.</p></div><span className="count-badge">{(projectDetail?.members || []).length + (projectDetail?.owner ? 1 : 0)} people</span></div><div className="member-list">{projectDetail?.owner && <div className="member-row"><div className="member-avatar owner-avatar">{projectDetail.owner.name.slice(0, 1).toUpperCase()}</div><div className="member-info"><strong>{projectDetail.owner.name}</strong><span>{projectDetail.owner.email}</span></div><span className="role-pill role-owner">OWNER</span></div>}{(projectDetail?.members || []).map((member) => <div className="member-row" key={member.id}><div className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</div><div className="member-info"><strong>{member.name}</strong><span>{member.email}</span></div><span className={`role-pill ${member.permission === "editor" ? "role-editor" : "role-viewer"}`}>{member.permission.toUpperCase()}</span></div>)}{!projectDetail?.owner && !projectDetail?.members?.length && <EmptyState icon="users" title="No members found" description="Choose a project to review its members." />}</div></section><section className="panel invite-panel"><div className="section-heading"><div><p className="eyebrow">INVITE A TEAMMATE</p><h2>Add project access</h2><p className="muted">The person must already have a registered EnvShare account.</p></div><span className="panel-icon violet-icon"><Icon name="users" /></span></div>{isOwner ? <form className="invite-form" onSubmit={addMember}><label>REGISTERED EMAIL<input type="email" required placeholder="teammate@company.com" value={memberForm.email} onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })} /></label><label>PERMISSION<select value={memberForm.permission} onChange={(event) => setMemberForm({ ...memberForm, permission: event.target.value })}><option value="viewer">Viewer â€” read-only access</option><option value="editor">Editor â€” manage variables</option></select></label><button className="primary-button" disabled={busy}><Icon name="plus" size={15} />{busy ? "Savingâ€¦" : "Add team member"}</button></form> : <div className="permission-notice"><Icon name="lock" size={18} /><div><strong>Owner permission required</strong><p>You can view the member list, but only the project owner can add or update team access.</p></div></div>}</section></>}
      </div>
      <footer className="app-footer"><span><span className="footer-gem">â—†</span> EnvShare <span className="footer-muted">Secure configuration, simplified.</span></span><span><i /> API workspace <span className="footer-muted">v1.0</span></span></footer>
    </main>
  </div>

    {modal === "project" && <Modal title="Create a project" subtitle="Start a secure space for the configuration behind your application." onClose={() => setModal("")}><form className="modal-form" onSubmit={createProject}><label>PROJECT NAME<input autoFocus required minLength={2} maxLength={100} placeholder="e.g. Mobile application" value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} /></label><label>DESCRIPTION <span className="optional-label">OPTIONAL</span><textarea rows={3} maxLength={500} placeholder="What is this project for?" value={projectForm.description} onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })} /></label><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => setModal("")}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Creatingâ€¦" : "Create project"}<Icon name="arrow" size={15} /></button></div></form></Modal>}

    {modal === "environment" && <Modal title="Add an environment" subtitle="Keep development, staging and production settings organized." onClose={() => setModal("")}><form className="modal-form" onSubmit={createEnvironment}><label>ENVIRONMENT NAME<input autoFocus required minLength={2} maxLength={40} placeholder="Development" value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} /></label><div className="environment-presets">{["Development", "Staging", "Production"].map((name) => <button type="button" key={name} className={`preset-chip ${environmentName === name ? "preset-selected" : ""}`} onClick={() => setEnvironmentName(name)}>{name}</button>)}</div><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => setModal("")}>Cancel</button><button className="primary-button" disabled={busy || !projectId || !canEdit}>{busy ? "Creatingâ€¦" : "Create environment"}<Icon name="arrow" size={15} /></button></div></form></Modal>}

    {modal === "variable" && <Modal title="Add a variable" subtitle={`Add a configuration key to ${selectedEnvironment?.name || "your environment"}.`} onClose={() => setModal("")}><form className="modal-form" onSubmit={createVariable}><label>VARIABLE KEY<input autoFocus required pattern="[A-Za-z_][A-Za-z0-9_]*" title="Use letters, numbers and underscores; must not start with a number." placeholder="DATABASE_URL" value={variableForm.key} onChange={(event) => setVariableForm({ ...variableForm, key: event.target.value })} /></label><label>VALUE<input required placeholder="Enter a value" value={variableForm.value} onChange={(event) => setVariableForm({ ...variableForm, value: event.target.value })} /></label><label className="sensitive-toggle"><input type="checkbox" checked={variableForm.is_sensitive} onChange={(event) => setVariableForm({ ...variableForm, is_sensitive: event.target.checked })} /><span><strong>Mark as sensitive</strong><small>Encrypt at rest and mask in standard listings.</small></span><Icon name="lock" size={17} /></label><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => setModal("")}>Cancel</button><button className="primary-button" disabled={busy || !environmentId || !canEdit}>{busy ? "Savingâ€¦" : "Save variable"}<Icon name="arrow" size={15} /></button></div></form></Modal>}

    {modal === "editVariable" && editForm && <Modal title="Edit variable" subtitle="Update the key or its value. Existing secret values remain protected." onClose={() => { setModal(""); setEditForm(null); }}><form className="modal-form" onSubmit={saveVariableEdit}><label>VARIABLE KEY<input autoFocus required pattern="[A-Za-z_][A-Za-z0-9_]*" value={editForm.key} onChange={(event) => setEditForm({ ...editForm, key: event.target.value })} /></label><label>VALUE<input placeholder={editForm.originalSensitive ? "Leave blank to keep current secret" : "Enter variable value"} value={editForm.value} onChange={(event) => setEditForm({ ...editForm, value: event.target.value })} /></label>{editForm.originalSensitive && <p className="field-note"><Icon name="lock" size={13} /> The existing value is masked. Leave the field blank to preserve it.</p>}<label className="sensitive-toggle"><input type="checkbox" checked={editForm.is_sensitive} onChange={(event) => setEditForm({ ...editForm, is_sensitive: event.target.checked })} /><span><strong>Mark as sensitive</strong><small>Encrypt at rest and mask in listings.</small></span><Icon name="shield" size={17} /></label><div className="modal-footer"><button type="button" className="secondary-button" onClick={() => { setModal(""); setEditForm(null); }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Savingâ€¦" : "Save changes"}<Icon name="arrow" size={15} /></button></div></form></Modal>}
  </div>;
}

function ResultCount({ label, value, color }) {
  return <div className={`result-count result-${color}`}><span>{label}</span><strong>{value}</strong></div>;
}
// ============================================
// ENVS HARE â€” PREMIUM ADMIN PANEL
// ============================================

function AdminPanel({ token, user }) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workingId, setWorkingId] = useState(null);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [stats, userData, projectData] = await Promise.all([
        apiRequest("/api/admin/overview", token),
        apiRequest("/api/admin/users", token),
        apiRequest("/api/admin/projects", token),
      ]);

      setOverview(stats);
      setUsers(userData.users || []);
      setProjects(projectData.projects || []);
    } catch (err) {
      setError(err.message || "Unable to load administrator data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && user?.role === "admin") {
      loadData();
    }
  }, [open, token, user?.role]);

  async function updateRole(account, role) {
    if (account.id === user?.id) {
      setError("Use another administrator account to change your own role.");
      return;
    }

    setWorkingId(account.id);
    setError("");
    setNotice("");

    try {
      await apiRequest(`/api/admin/users/${account.id}/role`, token, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });

      setNotice(`Role updated for ${account.email}.`);
      await loadData();
    } catch (err) {
      setError(err.message || "Could not update the user role.");
    } finally {
      setWorkingId(null);
    }
  }

  // Never render the administrator controls for non-admin accounts.
  if (user?.role !== "admin") {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="admin-launcher"
        onClick={() => setOpen(true)}
      >
        <span className="admin-launcher-icon">âœ¦</span>
        Admin Panel
        <span className="admin-launcher-badge">ADMIN</span>
      </button>

      {open && (
        <div
          className="admin-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <section
            className="admin-window"
            role="dialog"
            aria-modal="true"
            aria-label="EnvShare administrator panel"
          >
            <header className="admin-window-header">
              <div className="admin-brand">
                <div className="admin-brand-mark">E</div>

                <div>
                  <span className="admin-kicker">
                    ENVS HARE Â· SYSTEM CONTROL
                  </span>
                  <h2>Administrator Console<span>.</span></h2>
                  <p>Manage your workspace with confidence.</p>
                </div>
              </div>

              <div className="admin-header-actions">
                <button
                  type="button"
                  className="admin-refresh"
                  onClick={loadData}
                  disabled={loading}
                >
                  â†» Refresh
                </button>

                <button
                  type="button"
                  className="admin-close"
                  onClick={() => setOpen(false)}
                  aria-label="Close Admin Panel"
                >
                  Ã—
                </button>
              </div>
            </header>

            <div className="admin-window-content">
              <div className="admin-welcome">
                <div>
                  <span className="admin-online-dot" />
                  PRIVILEGED ACCESS ACTIVE
                  <p>
                    Signed in as {user.name || user.email}
                  </p>
                </div>

                <div className="admin-shield">â™¢</div>
              </div>

              {error && (
                <div className="admin-alert admin-alert-error">
                  {error}
                </div>
              )}

              {notice && (
                <div className="admin-alert admin-alert-success">
                  {notice}
                </div>
              )}

              {loading && !overview ? (
                <div className="admin-loading">
                  Loading protected system informationâ€¦
                </div>
              ) : (
                <>
                  <div className="admin-metrics">
                    <article className="admin-metric metric-gold">
                      <span>REGISTERED USERS</span>
                      <strong>{overview?.users ?? "â€”"}</strong>
                      <small>
                        {overview?.admins ?? 0} administrators
                      </small>
                    </article>

                    <article className="admin-metric metric-violet">
                      <span>PROJECTS</span>
                      <strong>{overview?.projects ?? "â€”"}</strong>
                      <small>Across the workspace</small>
                    </article>

                    <article className="admin-metric metric-mint">
                      <span>ENVIRONMENTS</span>
                      <strong>{overview?.environments ?? "â€”"}</strong>
                      <small>
                        {overview?.variables ?? 0} variables tracked
                      </small>
                    </article>

                    <article className="admin-metric metric-blue">
                      <span>ACTIVITY EVENTS</span>
                      <strong>{overview?.activity_events ?? "â€”"}</strong>
                      <small>Audit trail records</small>
                    </article>
                  </div>

                  <section className="admin-section">
                    <div className="admin-section-heading">
                      <div>
                        <span>ACCOUNT DIRECTORY</span>
                        <h3>User Management</h3>
                        <p>
                          View registered accounts and manage their roles.
                        </p>
                      </div>

                      <span className="admin-total">
                        {users.length} accounts
                      </span>
                    </div>

                    {users.length === 0 ? (
                      <p className="admin-empty">No accounts found.</p>
                    ) : (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>USER</th>
                              <th>EMAIL</th>
                              <th>ROLE</th>
                            </tr>
                          </thead>

                          <tbody>
                            {users.map((account) => (
                              <tr key={account.id}>
                                <td>
                                  <div className="admin-user-cell">
                                    <div className="admin-avatar">
                                      {(account.name || account.email || "U")
                                        .slice(0, 1)
                                        .toUpperCase()}
                                    </div>

                                    <div>
                                      <strong>
                                        {account.name || "User"}
                                      </strong>

                                      <small>
                                        Account #{account.id}
                                      </small>
                                    </div>
                                  </div>
                                </td>

                                <td className="admin-email">
                                  {account.email}
                                </td>

                                <td>
                                  <select
                                    className="admin-role-select"
                                    aria-label={`Role for ${account.email}`}
                                    value={account.role}
                                    disabled={
                                      workingId === account.id ||
                                      account.id === user?.id
                                    }
                                    onChange={(event) =>
                                      updateRole(
                                        account,
                                        event.target.value
                                      )
                                    }
                                  >
                                    <option value="user">User</option>
                                    <option value="admin">Admin</option>
                                  </select>

                                  {account.id === user?.id && (
                                    <small className="admin-self-label">
                                      Current account
                                    </small>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="admin-section">
                    <div className="admin-section-heading">
                      <div>
                        <span>WORKSPACE DIRECTORY</span>
                        <h3>All Projects</h3>
                        <p>
                          Project ownership and configuration counts.
                        </p>
                      </div>

                      <span className="admin-total">
                        {projects.length} projects
                      </span>
                    </div>

                    {projects.length === 0 ? (
                      <p className="admin-empty">No projects found.</p>
                    ) : (
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>PROJECT</th>
                              <th>OWNER</th>
                              <th>ENVIRONMENTS</th>
                              <th>VARIABLES</th>
                            </tr>
                          </thead>

                          <tbody>
                            {projects.map((project) => (
                              <tr key={project.id}>
                                <td>
                                  <div className="admin-project-cell">
                                    <span className="admin-project-symbol">
                                      â—ˆ
                                    </span>

                                    <div>
                                      <strong>{project.name}</strong>
                                      <small>Project #{project.id}</small>
                                    </div>
                                  </div>
                                </td>

                                <td className="admin-email">
                                  {project.owner_email}
                                </td>

                                <td>
                                  <span className="admin-count-pill">
                                    {project.environment_count}
                                  </span>
                                </td>

                                <td>
                                  <span className="admin-count-pill">
                                    {project.variable_count}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <footer className="admin-footer">
                    <span>ENVS HARE Â· ADMINISTRATION</span>
                    <span>SECURE SYSTEM OVERVIEW</span>
                  </footer>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
