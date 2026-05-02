"use client";

import React, { useState } from "react";
import type { Rule } from "@/types/db";

export function EditRuleButton({
  rule,
  updateAction,
  accountName,
}: {
  rule: Rule;
  updateAction: (fd: FormData) => Promise<void>;
  accountName?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-tiny rounded-md border min-h-[32px] inline-flex items-center justify-center border-line-2 hover:border-accent/40 px-2.5 py-1 text-dim-2 hover:text-accent transition-colors"
      >
        editar
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-surface border border-line-2 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <h2 className="font-semibold text-lg">Editar regra</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-dim-2 hover:text-fg text-xl leading-none"
          >
            ×
          </button>
        </div>
        <form
          action={async (fd) => {
            await updateAction(fd);
            setOpen(false);
          }}
          className="p-5 space-y-4"
        >
          <input type="hidden" name="id" value={rule.id} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-tiny text-dim-2 uppercase tracking-wider block">Nome da regra</label>
              <input
                name="name"
                defaultValue={rule.name}
                required
                className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-tiny text-dim-2 uppercase tracking-wider block">Tipo de gatilho</label>
              <select
                name="trigger_type"
                defaultValue={rule.trigger_type}
                className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="comment">Comentário em post</option>
                <option value="first_dm">Primeira DM (boas-vindas)</option>
                <option value="story_reply">Resposta a story</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-tiny text-dim-2 uppercase tracking-wider block">Keyword</label>
              <input
                name="keyword"
                defaultValue={rule.keyword ?? ""}
                placeholder='Ex: "QUERO" — vazio = qualquer'
                className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-tiny text-dim-2 uppercase tracking-wider block">Match mode</label>
              <select
                name="match_mode"
                defaultValue={rule.match_mode}
                className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="contains">contém keyword</option>
                <option value="exact">exato</option>
                <option value="starts_with">começa com</option>
                <option value="any">qualquer texto dispara</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-tiny text-dim-2 uppercase tracking-wider block">
              Resposta pública (só comentário)
            </label>
            <textarea
              name="public_reply"
              defaultValue={rule.public_reply ?? ""}
              rows={2}
              className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors resize-y"
            />
          </div>

          <div className="space-y-1">
            <label className="text-tiny text-dim-2 uppercase tracking-wider block">
              Mensagem DM *
            </label>
            <textarea
              name="dm_message"
              defaultValue={rule.dm_message}
              rows={3}
              required
              className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors resize-y"
            />
          </div>

          <div className="space-y-2">
            <label className="text-tiny text-dim-2 uppercase tracking-wider block">Botões (até 3)</label>
            {[0, 1, 2].map((i) => {
              const b = rule.dm_buttons?.[i];
              return (
                <div key={i} className="grid grid-cols-[1fr_2fr] gap-2">
                  <input
                    name={`btn_text_${i}`}
                    placeholder={`Botão ${i + 1} · texto`}
                    maxLength={20}
                    defaultValue={b?.title ?? ""}
                    className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors"
                  />
                  <input
                    name={`btn_url_${i}`}
                    placeholder={`Botão ${i + 1} · URL`}
                    defaultValue={b?.url ?? ""}
                    className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors"
                  />
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3">
            <div className="space-y-1">
              <label className="text-tiny text-dim-2 uppercase tracking-wider block">Follow-up (h)</label>
              <input
                name="followup_delay_hours"
                type="number"
                min={0}
                defaultValue={rule.followup_delay_hours ?? 0}
                className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-tiny text-dim-2 uppercase tracking-wider block">Mensagem follow-up</label>
              <textarea
                name="followup_message"
                rows={2}
                defaultValue={rule.followup_message ?? ""}
                className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors resize-y"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-line">
            <div className="space-y-1">
              <label className="text-tiny text-dim-2 uppercase tracking-wider block">Prioridade</label>
              <input
                name="priority"
                type="number"
                defaultValue={rule.priority}
                className="w-32 bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-line-2 px-4 py-2 text-sm text-dim-2 hover:text-fg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-5 py-2 text-sm transition-colors"
              >
                Salvar alterações
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
