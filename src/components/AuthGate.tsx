import { useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Lock, LogIn } from 'lucide-react';

interface Props {
  authReady: boolean;
  signingIn: boolean;
  error: string | null;
  onSignIn: () => void;
}

export function AuthGate({ authReady, signingIn, error, onSignIn }: Props) {
  const [copiedHost, setCopiedHost] = useState(false);
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const isUnauthorizedDomain = Boolean(error && error.includes('not authorized in Firebase Auth'));

  const handleCopyHost = async () => {
    if (!currentHost) return;
    try {
      await navigator.clipboard.writeText(currentHost);
      setCopiedHost(true);
      setTimeout(() => setCopiedHost(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F1F5F9] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-[#111827] border border-slate-800/90 rounded-xl p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-5">
          <div>
            <div className="font-display text-xl font-bold tracking-tight text-slate-100">
              MiroFish
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Universal Swarm Prediction &amp; AI Failover Proxy
            </div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-[#161F30] border border-slate-700/80 flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-sky-400" />
          </div>
        </div>

        {!authReady ? (
          <div className="py-6 flex items-center justify-center gap-3 text-sm text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>Verifying session...</span>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-lg font-semibold text-slate-100">
                Sign in required to access workspace
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                This application is locked to authenticated accounts. Sign in with Google to
                access swarm simulations, your private provider key vault, and saved forecasts.
              </p>
            </div>

            {error && (
              <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-3.5 py-3 text-xs text-rose-200 space-y-2.5">
                <p className="leading-relaxed">{error}</p>
                {isUnauthorizedDomain && currentHost && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleCopyHost()}
                      className="px-2.5 py-1 rounded border border-rose-400/40 bg-rose-950/60 hover:bg-rose-900/50 text-[11px] font-mono-tabular text-rose-100 flex items-center gap-1.5"
                    >
                      {copiedHost ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedHost ? 'Copied' : `Copy "${currentHost}"`}
                    </button>
                    <a
                      href="https://console.firebase.google.com/project/gen-lang-client-0138811022/authentication/settings"
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 rounded border border-slate-700 bg-[#0B0F17] hover:border-sky-400 text-[11px] text-sky-300 flex items-center gap-1"
                    >
                      <span>Open Authorized Domains</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={signingIn}
              onClick={onSignIn}
              className="w-full px-4 py-3 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {signingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in with Google...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Sign in with Google</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
