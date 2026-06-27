import React, { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getUsers, createUser, updateUser, deactivateUser, reactivateUser } from '../services/api';
import Icon from '../components/ui/Icon';
import { PageHeader, Pill, Field, TextInput, SelectInput, EmptyState } from '../components/ui';

const JOB_TITLES = ['Admin', 'PM', 'SPV', 'Director'];
const ROLE_FOR_TITLE = { Admin: 'admin', PM: 'operator', SPV: 'operator', Director: 'viewer' };
const ROLE_LABELS = { admin: 'Admin', operator: 'Operator', viewer: 'Viewer' };
const ROLE_TONES = { admin: 'bad', operator: 'info', viewer: 'neutral' };

function roleTone(role) {
  return ROLE_TONES[role] || 'neutral';
}

const EMPTY_FORM = { username: '', email: '', password: '', job_title: 'PM', role: 'operator' };

function UserModal({ initial, onClose, onSaved }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(
    isEdit
      ? { email: initial.email || '', job_title: initial.job_title || 'PM', role: initial.role }
      : { ...EMPTY_FORM }
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleJobTitle = (jt) => {
    set('job_title', jt);
    set('role', ROLE_FOR_TITLE[jt] || 'operator');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!isEdit && (!form.username || !form.password)) {
      setErr('Username and password are required.');
      return;
    }
    if (!isEdit && form.password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await updateUser(initial.user_id, {
          email: form.email || null,
          job_title: form.job_title,
          role: form.role,
        });
      } else {
        await createUser({
          username: form.username,
          email: form.email || undefined,
          password: form.password,
          job_title: form.job_title,
          role: form.role,
        });
      }
      onSaved();
    } catch (e2) {
      const msg = e2?.response?.data?.error || 'Something went wrong.';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-bg border border-line rounded-card shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-[15px] font-semibold">{isEdit ? 'Edit User' : 'Add User'}</h2>
          <button onClick={onClose} className="btn btn-icon btn-ghost">
            <Icon name="x" size={15} />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {err && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-bad/15 text-bad">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}
          {!isEdit && (
            <Field label="Username">
              <TextInput
                icon="user"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                placeholder="e.g. budi.santoso"
                autoFocus
              />
            </Field>
          )}
          <Field label="Email">
            <TextInput
              icon="mail"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="user@company.com"
            />
          </Field>
          {!isEdit && (
            <Field label="Password">
              <TextInput
                icon="lock"
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="Min. 8 characters"
              />
            </Field>
          )}
          <Field label="Job Title">
            <SelectInput
              value={form.job_title}
              onChange={(e) => handleJobTitle(e.target.value)}
            >
              {JOB_TITLES.map((jt) => (
                <option key={jt} value={jt}>{jt}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Role" hint="Auto-suggested from job title. Adjust if needed.">
            <SelectInput value={form.role} onChange={(e) => set('role', e.target.value)}>
              <option value="admin">admin</option>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </SelectInput>
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Saving
                </span>
              ) : isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmDialog({ message, confirmLabel = 'Confirm', onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-bg border border-line rounded-card shadow-xl p-5">
        <p className="text-[14px] text-ink">{message}</p>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={onConfirm} className="btn btn-primary">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [actionBusy, setActionBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getUsers();
      setUsers(data);
    } catch (e) {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (user?.role !== 'admin') {
    return <Navigate to="/overview" replace />;
  }

  const handleSaved = () => {
    setModal(null);
    load();
  };

  const handleDeactivate = (u) => {
    setConfirm({
      message: `Deactivate ${u.username}? They will no longer be able to log in.`,
      confirmLabel: 'Deactivate',
      onConfirm: async () => {
        setConfirm(null);
        setActionBusy(u.user_id);
        try {
          await deactivateUser(u.user_id);
          await load();
        } catch (e) {
        } finally {
          setActionBusy(null);
        }
      },
    });
  };

  const handleReactivate = async (u) => {
    setActionBusy(u.user_id);
    try {
      await reactivateUser(u.user_id);
      await load();
    } catch (e) {
    } finally {
      setActionBusy(null);
    }
  };

  const fmtDate = (ts) =>
    ts ? new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="space-y-5">
      <PageHeader
        title="User Management"
        subtitle="Create and manage dashboard users. Only admins can access this page."
        actions={
          <button className="btn btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Icon name="plus" size={13} />
            Add User
          </button>
        }
      />

      {/* Desktop table */}
      <div className="card overflow-hidden hidden lg:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-ink3 text-[12px]">
              <th className="px-5 py-3 font-medium">Name / Username</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Job Title</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-ink3">Loading users…</td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-ink3">No users found.</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.user_id} className="hover:bg-surface2 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-surface3 flex items-center justify-center text-[11px] font-semibold shrink-0">
                      {u.username.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="font-medium">{u.username}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-ink2">{u.email || '—'}</td>
                <td className="px-5 py-3 text-ink2">{u.job_title || '—'}</td>
                <td className="px-5 py-3">
                  <Pill tone={roleTone(u.role)}>{ROLE_LABELS[u.role] || u.role}</Pill>
                </td>
                <td className="px-5 py-3">
                  <Pill tone={u.active ? 'ok' : 'neutral'}>{u.active ? 'Active' : 'Inactive'}</Pill>
                </td>
                <td className="px-5 py-3 text-ink3 mono tnum">{fmtDate(u.created_at)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      className="btn btn-ghost h-7 text-[12px] px-2.5"
                      onClick={() => setModal({ type: 'edit', user: u })}
                    >
                      <Icon name="settings" size={12} />
                      Edit
                    </button>
                    {u.active ? (
                      <button
                        className="btn btn-ghost h-7 text-[12px] px-2.5 text-bad hover:text-bad"
                        disabled={actionBusy === u.user_id}
                        onClick={() => handleDeactivate(u)}
                      >
                        {actionBusy === u.user_id ? '…' : 'Deactivate'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-ghost h-7 text-[12px] px-2.5 text-ok hover:text-ok"
                        disabled={actionBusy === u.user_id}
                        onClick={() => handleReactivate(u)}
                      >
                        {actionBusy === u.user_id ? '…' : 'Reactivate'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="lg:hidden space-y-3">
        {loading && <div className="py-10 text-center text-ink3 text-[13px]">Loading users…</div>}
        {!loading && users.length === 0 && (
          <div className="card">
            <EmptyState icon="users" title="No users" hint="Add your first user above." />
          </div>
        )}
        {users.map((u) => (
          <div key={u.user_id} className="card card-pad space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-full bg-surface3 flex items-center justify-center text-[11.5px] font-semibold shrink-0">
                  {u.username.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium truncate">{u.username}</div>
                  <div className="text-[12px] text-ink3 truncate">{u.email || '—'}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Pill tone={roleTone(u.role)}>{ROLE_LABELS[u.role] || u.role}</Pill>
                <Pill tone={u.active ? 'ok' : 'neutral'}>{u.active ? 'Active' : 'Inactive'}</Pill>
              </div>
            </div>
            <div className="text-[12px] text-ink3">
              {u.job_title || '—'} · Created {fmtDate(u.created_at)}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                className="btn btn-ghost h-7 text-[12px] px-2.5"
                onClick={() => setModal({ type: 'edit', user: u })}
              >
                <Icon name="settings" size={12} />
                Edit
              </button>
              {u.active ? (
                <button
                  className="btn btn-ghost h-7 text-[12px] px-2.5 text-bad"
                  disabled={actionBusy === u.user_id}
                  onClick={() => handleDeactivate(u)}
                >
                  {actionBusy === u.user_id ? '…' : 'Deactivate'}
                </button>
              ) : (
                <button
                  className="btn btn-ghost h-7 text-[12px] px-2.5 text-ok"
                  disabled={actionBusy === u.user_id}
                  onClick={() => handleReactivate(u)}
                >
                  {actionBusy === u.user_id ? '…' : 'Reactivate'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {modal?.type === 'add' && (
        <UserModal onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.type === 'edit' && (
        <UserModal initial={modal.user} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
