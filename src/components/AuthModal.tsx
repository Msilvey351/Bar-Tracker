"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  onClose: () => void;
}

export default function AuthModal({ onClose }: Props) {
  const [email,     setEmail]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const supabase = createClient();

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // ✨ NEW: Appended ?resume=true so the UI knows to pull from cache
        redirectTo: `${window.location.origin}/auth/callback?resume=true`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // ✨ NEW: Appended ?resume=true here too for email login
        emailRedirectTo: `${window.location.origin}/auth/callback?resume=true`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-white">Sign in</h2>
            <p className="text-white/40 text-xs mt-0.5">
              Save your sets and track progress over time
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
          >
            ✕
          </button>
        </div>

        {sent ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">📧</div>
            <h3 className="font-bold text-white mb-1">Check your email</h3>
            <p className="text-white/50 text-sm">
              We sent a magic link to <strong className="text-white">{email}</strong>.
              Click the link to sign in — no password needed.
            </p>
            <button
              onClick={onClose}
              className="mt-4 w-full py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors text-sm"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-zinc-200 text-black font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {loading ? "Connecting..." : "Continue with Google"}
            </button>

            <p className="text-white/40 text-[10px] text-center mt-4 px-4">
              By signing in, you agree to our <a href="/terms" className="underline">Terms of Service</a> and <a href="/privacy" className="underline">Privacy Policy</a>. 
              Velocity Data is a beta tool. Always lift safely and at your own risk.
            </p>

            <div className="flex items-center gap-3">
              <div className="h-px bg-white/10 flex-1" />
              <span className="text-white/30 text-[10px] font-bold uppercase tracking-widest">Or use email</span>
              <div className="h-px bg-white/10 flex-1" />
            </div>

            <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-orange-500 transition-colors"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800/40 text-white font-semibold rounded-xl transition-colors border border-white/5"
              >
                Send Magic Link
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}