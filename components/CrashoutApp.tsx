"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Rant } from "@/lib/store";
import BackgroundFX from "./BackgroundFX";
import Logo from "./Logo";
import RantWall, { RantWallHandle } from "./RantWall";
import RantForm, { Verdict } from "./RantForm";

const POLL_MS = 10_000;

export default function CrashoutApp() {
  const [rants, setRants] = useState<Rant[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [globalView, setGlobalView] = useState(false);
  const wallRef = useRef<RantWallHandle>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/rants", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { rants: Rant[]; total: number };
      if (Array.isArray(data.rants)) {
        setRants(data.rants);
        setTotal(data.total ?? data.rants.length);
      }
    } catch {
      // network blip — the wall keeps floating on what it has
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const submit = useCallback(
    async (text: string, origin: { x: number; y: number }): Promise<boolean> => {
      setBusy(true);
      setVerdict(null);
      try {
        const res = await fetch("/api/rants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = (await res.json()) as
          | { ok: true; rant: Rant | null }
          | { ok: false; kind: string; message: string; support?: boolean };

        if (data.ok && data.rant) {
          wallRef.current?.spawn(data.rant);
          setRants((prev) => [data.rant!, ...prev]);
          setTotal((t) => t + 1);
          setGlobalView(false); // pop back to the wall to watch it land
          return true;
        }
        if (!data.ok) {
          setVerdict({ kind: data.kind, message: data.message, support: data.support });
        }
        return false;
      } catch {
        setVerdict({ kind: "network", message: "The wall didn't hear that. Try again." });
        return false;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return (
    <main className="app">
      <BackgroundFX />
      <RantWall ref={wallRef} rants={rants} globalView={globalView} />
      {rants.length === 0 && (
        <div className="empty-wall">
          <span className="empty-big">NOTHING ON THE WALL YET</span>
          <span className="empty-sub">be the first to crash out</span>
        </div>
      )}
      <Logo />
      <RantForm
        busy={busy}
        verdict={verdict}
        onSubmit={submit}
        onDismissVerdict={() => setVerdict(null)}
      />

      <div className="wall-count">
        {total.toLocaleString()} crashouts thrown at the wall
      </div>

      {rants.length > 0 && !globalView && (
        <div className="scroll-hint">scroll to roam the wall</div>
      )}

      <button
        className={`view-btn ui-chrome${globalView ? " on" : ""}`}
        onClick={() => setGlobalView((g) => !g)}
      >
        {globalView ? "close global view" : "global view"}
      </button>

      <button className="rules-btn ui-chrome" onClick={() => setRulesOpen((o) => !o)}>
        rules of the wall
      </button>

      {rulesOpen && (
        <aside className="rules-panel" onClick={() => setRulesOpen(false)}>
          <h2>RULES OF THE WALL</h2>
          <ul>
            <li className="yes">rage, cussing, despair, ALL CAPS — welcome</li>
            <li className="yes">everything is anonymous. forever.</li>
            <li className="no">threats, slurs, or harm aimed at anyone</li>
            <li className="no">names, numbers, addresses, links</li>
            <li className="no">rants about the wall itself. it&apos;s sensitive.</li>
            <li className="yes">struggling for real? Samaritans 116 123 (UK) · 988 (US)</li>
          </ul>
        </aside>
      )}
    </main>
  );
}
