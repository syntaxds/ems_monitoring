import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgotPassword } from '../services/api';
import Icon from '../components/ui/Icon';
import { Field, TextInput, BrandMark } from '../components/ui';
import heroImg from '../assets/login-hero.jpg';
import logoImg from '../assets/logo.png';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [locked, setLocked] = useState(false);

  // Too many failed attempts (HTTP 429): lock the page and bounce to root.
  useEffect(() => {
    if (!locked) return;
    const t = setTimeout(() => navigate('/'), 5000);
    return () => clearTimeout(t);
  }, [locked, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (locked) return;
    setErr('');
    if (!email) {
      setErr('Enter your email address to continue.');
      return;
    }
    if (!/@pmjsystem\.com$/i.test(email.trim())) {
      setErr('Please check your email again');
      return;
    }
    setBusy(true);
    try {
      await forgotPassword(email);
      setDone(true);
    } catch (e2) {
      if (e2?.response?.status === 429) {
        setErr(e2?.response?.data?.error || 'Please try again in 10 Minutes');
        setLocked(true);
      } else {
        setErr(e2?.response?.data?.error || 'Please check your email again');
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

          {done ? (
            <div className="space-y-5">
              <div className="w-12 h-12 rounded-full bg-ok/15 flex items-center justify-center">
                <Icon name="mail" size={22} className="text-ok" />
              </div>
              <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Check your email</h1>
              <p className="text-[13.5px] text-ink2 leading-relaxed">
                If that email is registered, a reset link has been sent. The link expires in 30 minutes.
              </p>
              <Link to="/login" className="inline-flex items-center gap-2 text-[13.5px] font-medium text-ink2 hover:text-ink">
                <Icon name="arrowRight" size={14} className="rotate-180" />
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-[26px] font-semibold tracking-tight leading-tight">Forgot password?</h1>
              <p className="text-[13.5px] text-ink2 mt-1.5">
                Enter the email linked to your account and we'll send you a reset link.
              </p>

              {err && (
                <div className="mt-5 flex items-start gap-2 px-3 py-2.5 rounded-btn text-[13px] bg-bad/15 text-bad">
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                  <span>{err}</span>
                </div>
              )}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <Field label="Email address">
                  <TextInput
                    icon="mail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoFocus
                    autoComplete="email"
                  />
                </Field>

                <button
                  type="submit"
                  disabled={busy || locked}
                  className="btn btn-primary w-full justify-center h-11 text-[14px] font-medium mt-2"
                >
                  {busy ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      Sending
                    </span>
                  ) : (
                    <>Send reset link <Icon name="arrowRight" size={14} /></>
                  )}
                </button>

                <div className="pt-1">
                  <Link to="/login" className="text-[12.5px] text-ink2 hover:text-ink font-medium">
                    Back to login
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
