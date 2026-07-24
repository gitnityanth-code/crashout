"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MAX_RANT_LENGTH } from "@/lib/moderation";

export interface Verdict {
  kind: string;
  message: string;
  support?: boolean;
}

interface Props {
  busy: boolean;
  verdict: Verdict | null;
  onSubmit: (text: string, origin: { x: number; y: number }) => Promise<boolean>;
  onDismissVerdict: () => void;
}

export default function RantForm({ busy, verdict, onSubmit, onDismissVerdict }: Props) {
  const [text, setText] = useState("");
  const [shaking, setShaking] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hpRef = useRef<HTMLInputElement>(null);

  // Rejections auto-clear — except the support message, which stays until dismissed.
  useEffect(() => {
    if (!verdict || verdict.support) return;
    const t = window.setTimeout(onDismissVerdict, 6500);
    return () => window.clearTimeout(t);
  }, [verdict, onDismissVerdict]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Honeypot filled = bot. Quietly pretend nothing happened.
    if (hpRef.current?.value) return;

    const rect = pillRef.current?.getBoundingClientRect();
    const origin = rect
      ? { x: rect.left + rect.width / 2, y: rect.bottom + 60 }
      : { x: window.innerWidth / 2, y: 260 };

    const accepted = await onSubmit(text, origin);
    if (accepted) {
      setText("");
    } else {
      setShaking(true);
      window.setTimeout(() => setShaking(false), 500);
    }
    inputRef.current?.focus();
  };

  const remaining = MAX_RANT_LENGTH - text.length;

  return (
    <form className="rant-form" onSubmit={handleSubmit}>
      <div ref={pillRef} className={`pill${shaking ? " shake" : ""}`}>
        <input
          ref={inputRef}
          className="rant-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_RANT_LENGTH + 40))}
          placeholder="Rant to your heart's content…"
          aria-label="Rant to your heart's content"
          maxLength={MAX_RANT_LENGTH + 40}
          autoComplete="off"
          spellCheck={false}
        />
        {/* honeypot — invisible to humans, irresistible to bots */}
        <input
          ref={hpRef}
          className="hp-field"
          type="text"
          name="tag"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        <button className="throw-btn" type="submit" disabled={busy || text.trim().length < 2}>
          {busy ? "THROWING…" : "THROW IT"}
        </button>
        <span className={`char-count${remaining < 40 ? " hot" : ""}`} aria-live="polite">
          {remaining < 60 ? `${remaining}` : `${text.length}/${MAX_RANT_LENGTH}`}
        </span>
      </div>

      {verdict && (
        <div
          className={`verdict${verdict.support ? " support" : ""}`}
          role="status"
          onClick={onDismissVerdict}
        >
          <span className="verdict-kicker">
            {verdict.support ? "HOLD ON —" : "THE WALL SAYS NO"}
          </span>
          {verdict.message}
        </div>
      )}
    </form>
  );
}
