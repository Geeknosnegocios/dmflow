"use client";

import React from "react";

type Button = { title: string; url: string };

/**
 * Instagram DM visual mockup.
 * Renders the business name + avatar on top and a bubble with message + button(s)
 * as they will appear in the real IG app.
 */
export function DmPreview({
  message,
  buttons,
  brandName = "andreyweslley",
  brandAvatar,
  username = "@pessoa",
}: {
  message: string;
  buttons?: Button[];
  brandName?: string;
  brandAvatar?: string;
  username?: string;
}) {
  const btns = (buttons ?? []).filter((b) => b.title && b.url).slice(0, 3);

  return (
    <div className="rounded-2xl border border-line-2 bg-gradient-to-b from-[#0d0f15] to-[#06070a] p-4 shadow-card">
      {/* phone-ish header */}
      <div className="flex items-center gap-3 pb-3 border-b border-line">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-pink-500 via-orange-500 to-yellow-500 flex items-center justify-center text-white font-bold text-xs">
          {brandName.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{brandName}</div>
          <div className="text-tiny text-dim-2">Instagram Direct · preview</div>
        </div>
      </div>

      {/* convo area */}
      <div className="py-4 space-y-3 min-h-[160px]">
        {/* Bot-received bubble (from business) */}
        <div className="flex items-end gap-2">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-pink-500 via-orange-500 to-yellow-500 flex-shrink-0" />
          <div className="max-w-[80%] space-y-1">
            <div className="rounded-2xl rounded-bl-md bg-white/[0.06] px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed">
              {message || (
                <span className="italic text-dim-2">(mensagem vazia)</span>
              )}
            </div>

            {btns.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {btns.map((b, i) => (
                  <div
                    key={i}
                    className="rounded-xl bg-white/[0.04] border border-line-2 px-3 py-2 text-sm text-center font-medium text-accent truncate"
                  >
                    {b.title || "(sem texto)"}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-line">
        <div className="flex-1 rounded-full bg-white/[0.04] border border-line px-3 py-1.5 text-tiny text-dim-2">
          Mensagem…
        </div>
        <div className="h-7 w-7 rounded-full bg-accent/20" />
      </div>
    </div>
  );
}
