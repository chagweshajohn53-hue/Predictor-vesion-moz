import { useEffect, useState, type ChangeEvent } from 'react';
import { ImagePlus, KeyRound, Link2, Plus, Trash2, ArrowRight, Loader2, ExternalLink } from 'lucide-react';
import { UNIVERSAL_PRESETS } from '../lib/api';
import { countProviderKeys } from '../lib/vaultClient';
import { KnowledgeGraphCanvas } from './KnowledgeGraphCanvas';
import type {
  ProxyProviderStatus,
  RoutingMode,
  SeedImage,
  SimulationWorkspace,
  UserVault,
} from '../types/mirofish';

interface Props {
  workspace: SimulationWorkspace;
  proxyStatus: ProxyProviderStatus | null;
  vault: UserVault;
  loading: boolean;
  error: string | null;
  onChangeWorkspace: (updater: (prev: SimulationWorkspace) => SimulationWorkspace) => void;
  onBuildGraph: () => void;
  onProceedToSwarm: () => void;
  onOpenVault: () => void;
}

export function Step1SeedGraph({
  workspace,
  proxyStatus,
  vault,
  loading,
  error,
  onChangeWorkspace,
  onBuildGraph,
  onProceedToSwarm,
  onOpenVault,
}: Props) {
  const [urlInput, setUrlInput] = useState('');
  const [textDraft, setTextDraft] = useState(workspace.seeds.textInputs[0] ?? '');

  useEffect(() => {
    setTextDraft(workspace.seeds.textInputs[0] ?? '');
  }, [workspace.id]);

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const readPromises = files.slice(0, 5).map(
      (file) =>
        new Promise<SeedImage | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const base64Data = result.includes(',') ? result.split(',')[1] : '';
            if (!base64Data) {
              resolve(null);
              return;
            }
            resolve({
              id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              mimeType: file.type || 'image/png',
              base64Data,
              sizeBytes: file.size,
            });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        })
    );

    const loaded = (await Promise.all(readPromises)).filter(Boolean) as SeedImage[];
    if (loaded.length > 0) {
      onChangeWorkspace((prev) => ({
        ...prev,
        seeds: {
          ...prev.seeds,
          images: [...prev.seeds.images, ...loaded].slice(0, 6),
        },
      }));
    }
    e.target.value = '';
  };

  const handleAddUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    onChangeWorkspace((prev) => ({
      ...prev,
      seeds: {
        ...prev.seeds,
        urls: prev.seeds.urls.includes(trimmed) ? prev.seeds.urls : [...prev.seeds.urls, trimmed],
      },
    }));
    setUrlInput('');
  };

  const handleTextChange = (val: string) => {
    setTextDraft(val);
    onChangeWorkspace((prev) => ({
      ...prev,
      seeds: {
        ...prev.seeds,
        textInputs: val.trim() ? [val] : [],
      },
    }));
  };

  const applyPreset = (presetId: string) => {
    const preset = UNIVERSAL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setTextDraft(preset.sampleText);
    onChangeWorkspace((prev) => ({
      ...prev,
      title: preset.label,
      directive: {
        ...prev.directive,
        prompt: preset.prompt,
        horizon: preset.horizon,
        domainHint: preset.domainHint,
      },
      seeds: {
        ...prev.seeds,
        textInputs: [preset.sampleText],
      },
    }));
  };

  const hasAnthropic = countProviderKeys(vault, 'anthropic') > 0;
  const hasGemini = countProviderKeys(vault, 'gemini') > 0 || Boolean(proxyStatus?.geminiConfigured);

  const routingOptions: Array<{ id: RoutingMode; label: string; enabled: boolean }> = [
    {
      id: 'freeflow-chain',
      label: 'FreeFlow Chain',
      enabled: true,
    },
    {
      id: 'hybrid-ensemble',
      label: 'Hybrid Ensemble',
      enabled: hasGemini,
    },
    {
      id: 'anthropic-specialist',
      label: 'Claude Haiku 5.5',
      enabled: hasAnthropic,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header + Presets */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 text-balance">
            01. Seed Briefing &amp; Knowledge Graph
          </h1>
          <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
            Provide your exact prediction prompt along with chart or document images, article URLs,
            and notes. The proxy extracts verifiable claims before spawning the simulation swarm.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-[#111827] p-1 rounded-md border border-slate-800/80">
          {UNIVERSAL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-sky-400 hover:bg-slate-800/70 rounded transition-colors whitespace-nowrap shrink-0"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Seed Configuration Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Directive & Prompt Lock */}
        <div className="xl:col-span-7 space-y-5 bg-[#111827] border border-slate-800/80 rounded-lg p-6">
          <div>
            <label htmlFor="prediction-prompt" className="block text-sm font-medium text-slate-200 mb-2">
              Prediction Prompt &amp; Requirements
            </label>
            <textarea
              id="prediction-prompt"
              rows={5}
              value={workspace.directive.prompt}
              onChange={(e) => {
                const prompt = e.target.value;
                onChangeWorkspace((prev) => ({
                  ...prev,
                  title:
                    prev.title === 'Untitled Forecast' && prompt.trim().length > 4
                      ? prompt.trim().slice(0, 48)
                      : prev.title,
                  directive: { ...prev.directive, prompt },
                }));
              }}
              placeholder="Describe exactly what you want predicted (e.g., forecast direction, probability, scenarios, risks, or timeline based on the uploaded images and articles)..."
              className="w-full rounded-md bg-[#0B0F17] border border-slate-800 px-3.5 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400 transition-colors"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="horizon-input" className="block text-xs font-medium text-slate-400 mb-1.5">
                Forecast Horizon
              </label>
              <input
                id="horizon-input"
                type="text"
                value={workspace.directive.horizon}
                onChange={(e) =>
                  onChangeWorkspace((prev) => ({
                    ...prev,
                    directive: { ...prev.directive, horizon: e.target.value },
                  }))
                }
                placeholder="e.g., Next 7 days, Q2 2027"
                className="w-full rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div>
              <label htmlFor="domain-input" className="block text-xs font-medium text-slate-400 mb-1.5">
                Domain Context
              </label>
              <input
                id="domain-input"
                type="text"
                value={workspace.directive.domainHint}
                onChange={(e) =>
                  onChangeWorkspace((prev) => ({
                    ...prev,
                    directive: { ...prev.directive, domainHint: e.target.value },
                  }))
                }
                placeholder="Universal, Macro/FX, Policy, Tech..."
                className="w-full rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {/* Proxy Routing & Grounding Controls */}
          <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-xs font-medium text-slate-400">Predictor Proxy Engine</div>
                <button
                  type="button"
                  onClick={onOpenVault}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Manage Vault</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1 bg-[#0B0F17] p-1 rounded-md border border-slate-800/80">
                {routingOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!opt.enabled}
                    onClick={() =>
                      onChangeWorkspace((prev) => ({
                        ...prev,
                        directive: { ...prev.directive, routingMode: opt.id },
                      }))
                    }
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      workspace.directive.routingMode === opt.id
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : opt.enabled
                          ? 'text-slate-300 hover:text-slate-100'
                          : 'text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={workspace.directive.groundingEnabled}
                onChange={(e) =>
                  onChangeWorkspace((prev) => ({
                    ...prev,
                    directive: { ...prev.directive, groundingEnabled: e.target.checked },
                  }))
                }
                className="w-4 h-4 accent-sky-400 rounded"
              />
              <span className="text-xs text-slate-300">Live Web &amp; URL Grounding</span>
            </label>
          </div>
        </div>

        {/* Right: Multimodal Evidence Uploader (Images, URLs, Articles) */}
        <div className="xl:col-span-5 space-y-5 bg-[#111827] border border-slate-800/80 rounded-lg p-6">
          {/* Images */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-200">
                Charts &amp; Image Evidence
              </span>
              <span className="font-mono-tabular text-xs text-slate-400">
                {workspace.seeds.images.length}/6
              </span>
            </div>

            <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-md border border-dashed border-slate-700 bg-[#0B0F17] hover:border-sky-400/70 cursor-pointer transition-colors text-xs text-slate-300">
              <ImagePlus className="w-4 h-4 text-sky-400" />
              <span>Upload chart screenshots, infographics, or documents</span>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="sr-only"
              />
            </label>

            {workspace.seeds.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2.5 mt-3">
                {workspace.seeds.images.map((img) => (
                  <div
                    key={img.id}
                    className="relative group rounded border border-slate-800 bg-[#0B0F17] overflow-hidden"
                  >
                    <img
                      src={`data:${img.mimeType};base64,${img.base64Data}`}
                      alt={img.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-20 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onChangeWorkspace((prev) => ({
                          ...prev,
                          seeds: {
                            ...prev.seeds,
                            images: prev.seeds.images.filter((i) => i.id !== img.id),
                          },
                        }))
                      }
                      className="absolute top-1 right-1 p-1 rounded bg-slate-950/80 text-slate-300 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Article URLs */}
          <div>
            <label htmlFor="url-seed-input" className="block text-sm font-medium text-slate-200 mb-2">
              Article &amp; Source URLs
            </label>
            <div className="flex gap-2">
              <input
                id="url-seed-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrl();
                  }
                }}
                placeholder="https://..."
                className="flex-1 rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
              />
              <button
                type="button"
                onClick={handleAddUrl}
                className="px-3 py-2 rounded-md border border-slate-700 bg-[#161F30] text-slate-200 hover:border-sky-400 transition-colors flex items-center gap-1 text-xs font-medium shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {workspace.seeds.urls.length > 0 && (
              <ul className="mt-2.5 space-y-1.5 max-h-24 overflow-y-auto">
                {workspace.seeds.urls.map((u) => (
                  <li
                    key={u}
                    className="flex items-center justify-between gap-2 text-xs text-slate-300 bg-[#0B0F17] px-2.5 py-1.5 rounded border border-slate-800/80"
                  >
                    <span className="truncate flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      {u}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeWorkspace((prev) => ({
                          ...prev,
                          seeds: {
                            ...prev.seeds,
                            urls: prev.seeds.urls.filter((x) => x !== u),
                          },
                        }))
                      }
                      className="text-slate-500 hover:text-rose-400 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Seed Text / Excerpts */}
          <div>
            <label htmlFor="seed-text-input" className="block text-sm font-medium text-slate-200 mb-2">
              Articles, Reports, or Raw Context
            </label>
            <textarea
              id="seed-text-input"
              rows={4}
              value={textDraft}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Paste news articles, earnings highlights, macro indicators, or background facts..."
              className="w-full rounded-md bg-[#0B0F17] border border-slate-800 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
            />
          </div>
        </div>
      </div>

      {/* Action Bar */}
      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span>{workspace.seeds.images.length} images</span>
          <span aria-hidden="true">·</span>
          <span>{workspace.seeds.urls.length} URLs</span>
          <span aria-hidden="true">·</span>
          <span>{workspace.directive.groundingEnabled ? 'Live grounding active' : 'Seed-only mode'}</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={loading || !workspace.directive.prompt.trim()}
            onClick={onBuildGraph}
            className="px-5 py-2.5 rounded-md bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Extracting Evidence &amp; Graph...
              </>
            ) : (
              <>Build Knowledge Graph</>
            )}
          </button>

          {workspace.graph && (
            <button
              type="button"
              onClick={onProceedToSwarm}
              className="px-4 py-2.5 rounded-md border border-slate-700 bg-[#161F30] hover:border-sky-400 text-slate-100 text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              Configure Swarm
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Rendered Graph & Extracted Evidence */}
      {loading && !workspace.graph && (
        <div className="border border-slate-800/80 bg-[#111827] rounded-lg p-6 space-y-4 animate-pulse">
          <div className="h-5 w-48 bg-slate-800 rounded" />
          <div className="h-64 w-full bg-slate-900 rounded" />
        </div>
      )}

      {workspace.graph && workspace.evidenceSummary && (
        <div className="space-y-6 pt-2">
          <KnowledgeGraphCanvas graph={workspace.graph} />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-4">
              <h3 className="text-base font-semibold text-slate-100">Extracted Evidence Claims</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                {workspace.evidenceSummary.brief}
              </p>

              <div className="divide-y divide-slate-800/70">
                {workspace.evidenceSummary.claims.map((claim) => (
                  <div key={claim.id} className="py-3 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <span className="font-mono-tabular text-slate-300">{claim.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{claim.sourceLabel}</span>
                      </div>
                      <p className="text-sm text-slate-200">{claim.claim}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`text-xs font-medium capitalize ${
                          claim.polarity === 'supporting'
                            ? 'text-emerald-400'
                            : claim.polarity === 'contradicting'
                              ? 'text-rose-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {claim.polarity}
                      </div>
                      <div className="font-mono-tabular text-xs text-slate-400 mt-0.5">
                        {claim.confidence}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 bg-[#111827] border border-slate-800/80 rounded-lg p-5 space-y-5">
              {workspace.evidenceSummary.imageInsights.length > 0 && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-sm font-semibold text-slate-100">
                      Visual Observations from Images
                    </h4>
                    {workspace.evidenceSummary.imageExtractorModel && (
                      <span className="font-mono-tabular text-[11px] text-slate-400">
                        {workspace.evidenceSummary.imageExtractorModel}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1.5 text-sm text-slate-300 list-disc pl-4">
                    {workspace.evidenceSummary.imageInsights.map((ins, i) => (
                      <li key={i}>{ins}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-slate-100 mb-2">
                  Identified Data Gaps &amp; Uncertainties
                </h4>
                {workspace.evidenceSummary.dataGaps.length === 0 ? (
                  <p className="text-xs text-slate-400">No critical gaps flagged.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm text-amber-200/90 list-disc pl-4">
                    {workspace.evidenceSummary.dataGaps.map((gap, i) => (
                      <li key={i}>{gap}</li>
                    ))}
                  </ul>
                )}
              </div>

              {workspace.evidenceSummary.groundedSources.length > 0 && (
                <div className="pt-3 border-t border-slate-800/80">
                  <h4 className="text-sm font-semibold text-slate-100 mb-2">
                    Grounded Web Citations
                  </h4>
                  <ul className="space-y-1.5">
                    {workspace.evidenceSummary.groundedSources.map((src, i) => (
                      <li key={i}>
                        <a
                          href={src.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-sky-400 hover:underline flex items-center gap-1.5 truncate"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{src.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
