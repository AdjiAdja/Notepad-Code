'use client';

import React, { useEffect, useState } from 'react';
import { Pencil, PlusSquare, Search, Settings, Bell, Info, Sparkles, Presentation, History, Upload } from 'lucide-react';

interface CanvasCard {
  id: string;
  phase: string;
  subTab: string;
  title: string;
  subtitle: string;
  body: string;
  tag: string;
  status: string;
}

interface WorkspaceSettings {
  brandName: string;
  logoDataUrl: string | null;
  glowPreset: string;
  surfaceMode: string;
  fontStyle: string;
}

export default function ProjectCanvasPage() {
  const [settings, setSettings] = useState<WorkspaceSettings>({
    brandName: 'Voyager One',
    logoDataUrl: null,
    glowPreset: 'periwinkle',
    surfaceMode: 'light',
    fontStyle: 'inter',
  });
  const [cards, setCards] = useState<CanvasCard[]>([]);
  const [activePhase, setActivePhase] = useState<'Fit' | 'Build' | 'Launch'>('Fit');
  const [activeSubTab, setActiveSubTab] = useState<string>('Vision');
  const [projectId, setProjectId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('Voyager One');

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then((r) => r.json()),
      fetch('/api/projects').then((r) => r.json()),
    ]).then(([s, projects]) => {
      if (s && !s.error) setSettings(s);
      if (Array.isArray(projects) && projects.length > 0) {
        setProjectId(projects[0].id);
        setProjectName(projects[0].name);
        setCards(projects[0].cards || []);
      }
    });
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const logoDataUrl = String(reader.result);
      setSettings((prev) => ({ ...prev, logoDataUrl }));
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoDataUrl }),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSparkIdea = async () => {
    if (!projectId) return;
    const idea = await fetch('/api/ai/brainstorm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, phase: activePhase, subTab: activeSubTab }),
    }).then((r) => r.json());

    const created = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        phase: activePhase,
        subTab: activeSubTab,
        title: idea.title,
        subtitle: idea.subtitle,
        body: idea.body,
        tag: idea.tag,
      }),
    }).then((r) => r.json());

    if (created?.id) setCards((prev) => [...prev, created]);
  };

  const visibleCards = cards.filter((c) => c.phase === activePhase && c.subTab === activeSubTab);

  return (
    <main className="min-h-screen p-4 sm:p-8 flex justify-center">
      <div className="relative w-full max-w-[1160px] bg-white rounded-[34px] shadow-xl p-6 sm:p-9 flex flex-col justify-between overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-2.5">
            <label className="w-10 h-10 rounded-full bg-white/90 shadow-sm border border-gray-100 flex items-center justify-center cursor-pointer overflow-hidden" title="Unggah Logo Website">
              {settings.logoDataUrl ? (
                <img src={settings.logoDataUrl} alt="Logo" className="w-6 h-6 object-contain" />
              ) : (
                <Upload className="w-4 h-4 text-slate-800" />
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </label>
            <span className="px-3.5 py-2 rounded-full bg-white/90 shadow-sm text-xs font-medium">{settings.brandName}</span>
            <button type="button" className="w-10 h-10 rounded-full bg-white/90 shadow-sm flex items-center justify-center"><Info className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-4 py-2 rounded-full bg-white/90 shadow-sm text-xs font-medium">{projectName}</span>
            <button type="button" onClick={handleSparkIdea} className="px-3.5 py-2 rounded-full bg-black text-white text-xs font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Spark Idea
            </button>
            <button type="button" className="w-10 h-10 rounded-full bg-white/90 shadow-sm flex items-center justify-center"><Settings className="w-4 h-4" /></button>
            <button type="button" className="w-10 h-10 rounded-full bg-white/90 shadow-sm flex items-center justify-center"><Search className="w-4 h-4" /></button>
            <button type="button" className="w-10 h-10 rounded-full bg-white/90 shadow-sm flex items-center justify-center"><Bell className="w-4 h-4" /></button>
          </div>
        </header>

        <section className="mt-10 z-10">
          <div className="flex gap-7">
            {(['Fit', 'Build', 'Launch'] as const).map((phase) => (
              <button
                key={phase}
                type="button"
                onClick={() => setActivePhase(phase)}
                className={`text-3xl tracking-tight ${activePhase === phase ? 'font-semibold text-black' : 'text-gray-300'}`}
              >
                {phase}
              </button>
            ))}
          </div>
          <div className="mt-4 border-b border-gray-200 pb-2 flex gap-6 text-xs font-medium">
            {['Vision', 'Product Goals', 'FBL Canvas'].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveSubTab(tab)}
                className={activeSubTab === tab ? 'text-black font-semibold underline underline-offset-8' : 'text-gray-500'}
              >
                {tab}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 flex-1 z-10">
          {visibleCards.map((card) => (
            <article key={card.id} className="canvas-card p-6 min-h-[200px] flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold">{card.title}</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">{card.subtitle}</p>
              </div>
              <div className="mt-6 flex items-end justify-between gap-3">
                <p className="text-xs text-gray-700">{card.body || 'Add Text...'}</p>
                <span className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0">
                  <Pencil className="w-3.5 h-3.5" />
                </span>
              </div>
            </article>
          ))}
        </section>

        <footer className="mt-8 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Presentation className="w-4 h-4" />
            <History className="w-4 h-4" />
          </div>
          <button type="button" className="h-10 px-5 rounded-full bg-black text-white text-xs font-medium flex items-center gap-2">
            <span>Add area</span>
            <PlusSquare className="w-3.5 h-3.5" />
          </button>
        </footer>
      </div>
    </main>
  );
}
