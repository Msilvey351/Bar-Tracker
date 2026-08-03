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

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
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
        {/* Header */}
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
          <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
            <div>
              <label className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
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
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 text-white font-bold rounded-xl transition-colors"
            >
              {loading ? "Sending…" : "Send Magic Link ✨"}
            </button>

            <p className="text-white/25 text-xs text-center">
              No password needed. We'll email you a sign-in link.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}