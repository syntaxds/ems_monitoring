import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { validateActivationToken, activateAccount } from '../services/api';
import Icon from '../components/ui/Icon';
import { Field, TextInput, BrandMark } from '../components/ui';
import heroImg from '../assets/login-hero.jpg';
import logoImg from '../assets/logo.png';

export default function ActivateAccount() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [username, setUsername] = useState('');
  const [tokenErr, setTokenErr] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  // Validate the token up front so the driver sees a clear error state
  // instead of filling out a form that's doomed to fail.
  useEffect(() => {
    if (!token) {
      setTokenErr('This activation link is missing its token.');
      setChecking(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await validateActivationToken(token);
        if (cancelled) return;
        setUsername(data.username || '');
        setValid(true);
      } catch (e) {
        if (cancelled) return;
        setTokenErr(e?.response?.data?.error || 'Invalid or expired activation link.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // On success, hand off to /login with a message rather than leaving the
  // driver stranded on a "done" screen with nowhere to go.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      navigate('/login', { replace: true, state: { message: 'Account activated. You can now sign in.' } });
    }, 2500);
    return () => clearTimeout(t);
  }, [done, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (newPassword.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await activateAccount(token, newPassword);
      setDone(true);
    } catch (e2) {
      const msg = e2?.response?.data?.error || '';
      if (e2?.response?.status === 400) {
        setValid(false);
        setTokenErr(msg || 'Invalid or expired activation link.');
      } else {
        setErr(msg || 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-bg">
      {/* LEFT — hero photo */}
      <div className="relative hidden lg:block overflow-hidden">
        <img src={heroImg} alt="Excavator on site" className="absolute inset-0 w-full h-full object-cover" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in oklch, var(--bg) 25%, transparent) 0%, color-mix(in oklch, var(--bg) 0%, transparent) 35%, color-mix(in oklch, var(--bg) 55%, transparent) 100%)',
          }}
        />
        <div
          className="absolute inset-y-0 right-0 w-32 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, var(--bg))' }}
        />
        <img
          src={logoImg}
          alt="Padas Mustapa Jaya"
          className="absolute top-8 left-8 z-10 block"
          style={{ width: 96, height: 96, objectFit: 'contain' }}
        />
      </div>

      {/* RIGHT — form */}
      <div className="flex items-center justify-center px-6 py-10 lg:px-12">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <BrandMark size={40} />
            <div className="leading-none">
              <div className="text-[15px] font-semibold tracking-tight">PMJ Fleet</div>
              <div className="text-[11.5px] text-ink3 mt-1">PT Padas Mustapa Jaya</div>
            </div>
          </div>

          {checking ? (
            <div className="space-y-5">
              <div className="w-12 h-12 rounded-full bg-surface2 flex items-center justify-center">
                <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin text-ink3" />
              </div>
              <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Checking your link…</h1>
              <p className="text-[13.5px] text-ink2 leading-relaxed">This will only take a moment.</p>
            </div>
          ) : done ? (
            <div className="space-y-5">
              <div className="w-12 h-12 rounded-full bg-ok/15 flex items-center justify-center">
                <Icon name="check" size={22} className="text-ok" />
              </div>
              <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Account activated</h1>
              <p className="text-[13.5px] text-ink2 leading-relaxed">
                Your password is set. Redirecting you to sign in…
              </p>
              <Link to="/login" className="inline-flex items-center gap-2 text-[13.5px] font-medium text-ink2 hover:text-ink">
                Go to login now <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          ) : !valid ? (
            <div className="space-y-5">
              <div className="w-12 h-12 rounded-full bg-bad/15 flex items-center justify-center">
                <Icon name="alert" size={22} className="text-bad" />
              </div>
              <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Link no longer works</h1>
              <p className="text-[13.5px] text-ink2 leading-relaxed">
                {tokenErr} Activation links expire after 7 days or once used. Ask your admin to resend the
                activation email, or to hand you the link directly.
              </p>
              <Link to="/login" className="inline-flex items-center gap-2 text-[13.5px] font-medium text-ink2 hover:text-ink">
                <Icon name="arrowRight" size={14} className="rotate-180" />
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-[26px] font-semibold tracking-tight leading-tight">
                Welcome{username ? `, ${username}` : ''}
              </h1>
              <p className="text-[13.5px] text-ink2 mt-1.5">
                Set a password to activate your PMJ Fleet account.
              </p>

              {err && (
                <div className="mt-5 flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-bad/15 text-bad">
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                  <span>{err}</span>
                </div>
              )}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <Field label="New password">
                  <div className="relative">
                    <TextInput
                      icon="lock"
                      type={showPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      autoFocus
                      autoComplete="new-password"
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

                <Field label="Confirm new password">
                  <TextInput
                    icon="lock"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                  />
                </Field>

                <button
                  type="submit"
                  disabled={busy}
                  className="btn btn-primary w-full justify-center h-11 text-[14px] font-medium mt-2"
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      Activating
                    </span>
                  ) : (
                    <>Activate account <Icon name="arrowRight" size={14} /></>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
