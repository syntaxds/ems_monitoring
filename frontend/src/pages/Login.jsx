import React, { useState } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/ui/Icon';
import { Field, TextInput, BrandMark } from '../components/ui';
import heroImg from '../assets/login-hero.jpg';
import logoImg from '../assets/logo.png';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Already logged in — go straight to the dashboard.
  if (isAuthenticated) {
    return <Navigate to="/overview" replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!username || !password) {
      setErr('Enter your credentials to continue.');
      return;
    }
    setBusy(true);
    try {
      await login(username, password);
      navigate('/overview', { replace: true });
    } catch (e2) {
      setErr('Authentication failed — check your username and password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-bg">
      {/* LEFT — hero photo */}
      <div className="relative hidden lg:block overflow-hidden">
        <img src={heroImg} alt="Excavator on site" className="absolute inset-0 w-full h-full object-cover" />
        {/* tonal overlay for legibility + brand cohesion */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in oklch, var(--bg) 25%, transparent) 0%, color-mix(in oklch, var(--bg) 0%, transparent) 35%, color-mix(in oklch, var(--bg) 55%, transparent) 100%)',
          }}
        />
        {/* fade into form column on the right edge */}
        <div
          className="absolute inset-y-0 right-0 w-32 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, var(--bg))' }}
        />
        {/* brand on hero, top-left */}
        <img
          src={logoImg}
          alt="Padas Mustapa Jaya"
          className="absolute top-8 left-8 z-10 block"
          style={{ width: 96, height: 96, objectFit: 'contain' }}
        />
      </div>

      {/* RIGHT — sign-in form */}
      <div className="flex items-center justify-center px-6 py-10 lg:px-12">
        <div className="w-full max-w-[400px]">
          {/* mobile brand */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <BrandMark size={40} />
            <div className="leading-none">
              <div className="text-[15px] font-semibold tracking-tight">PMJ Fleet</div>
              <div className="text-[11.5px] text-ink3 mt-1">PT Padas Mustapa Jaya</div>
            </div>
          </div>

          <h1 className="text-[26px] font-semibold tracking-tight leading-tight">Sign in</h1>
          <p className="text-[13.5px] text-ink2 mt-1.5">Continue to the live fleet console.</p>

          {err && (
            <div className="mt-5 flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-bad/15 text-bad">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Username">
              <TextInput
                icon="user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                autoFocus
              />
            </Field>

            <Field label="Password">
              <div className="relative">
                <TextInput
                  icon="lock"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink p-1.5"
                >
                  <Icon name={showPw ? 'eyeOff' : 'eye'} size={14} />
                </button>
              </div>
            </Field>

            <div className="flex items-center justify-between text-[12.5px] pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <span
                  onClick={() => setRemember((r) => !r)}
                  className="w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors"
                  style={{
                    background: remember ? 'var(--accent)' : 'transparent',
                    borderColor: remember ? 'var(--accent)' : 'var(--border-strong)',
                  }}
                >
                  {remember && <Icon name="check" size={11} strokeWidth={3} style={{ color: 'var(--accent-ink)' }} />}
                </span>
                <span className="text-ink2">Keep me signed in</span>
              </label>
              <Link to="/forgot-password" className="text-ink2 hover:text-ink font-medium">
                Forgot?
              </Link>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary w-full justify-center h-11 text-[14px] font-medium mt-2"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Signing in
                </span>
              ) : (
                <>
                  Sign in <Icon name="arrowRight" size={14} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
