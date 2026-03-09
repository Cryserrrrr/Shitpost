import React, { useState } from "react";
import { SHARED_CONFIG, updatePseudo } from "../shared";
import { Icons } from "./Icons";
import { t } from "../i18n";

interface PseudoConfigProps {
  onClose: () => void;
}

function PseudoConfig({ onClose }: PseudoConfigProps) {
  const [pseudo, setPseudo] = useState(SHARED_CONFIG.pseudo);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!pseudo.trim()) {
      setError("Le pseudo ne peut pas être vide");
      return;
    }

    if (pseudo.length < 2) {
      setError("Le pseudo doit contenir au moins 2 caractères");
      return;
    }

    if (pseudo.length > 20) {
      setError("Le pseudo ne peut pas dépasser 20 caractères");
      return;
    }

    updatePseudo(pseudo);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 z-50"
      style={{ background: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(8px)' }}
    >
      <div className="glass-card p-8 max-w-md w-full animate-fade-in">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'var(--accent-primary-glow)',
                border: '1px solid rgba(16, 185, 129, 0.3)'
              }}
            >
              <Icons.Edit size={18} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <h2
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              Modifier le pseudo
            </h2>
          </div>
          <button
            onClick={onClose}
            className="btn-icon"
            aria-label="Fermer"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="pseudo-config"
              className="block text-sm font-medium mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              Nouveau pseudo
            </label>
            <input
              id="pseudo-config"
              type="text"
              value={pseudo}
              onChange={(e) => {
                setPseudo(e.target.value);
                setError("");
              }}
              placeholder={t("settings.pseudo_placeholder")}
              className="input-dark w-full"
              maxLength={20}
              autoFocus
            />
            {error && (
              <p
                className="mt-3 text-sm flex items-center gap-2"
                style={{ color: 'var(--error)' }}
              >
                <Icons.Warning size={16} />
                {error}
              </p>
            )}
            <div className="flex justify-between mt-2">
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                2 à 20 caractères
              </p>
              <p
                className="text-xs font-medium"
                style={{ color: pseudo.length > 15 ? 'var(--accent-warm)' : 'var(--text-tertiary)' }}
              >
                {pseudo.length}/20
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
            >
              Sauvegarder
            </button>
          </div>
        </form>

        {/* Hint */}
        <div
          className="mt-6 p-4 rounded-xl flex items-start gap-3"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <Icons.Lightbulb size={18} style={{ color: 'var(--accent-warm)', flexShrink: 0, marginTop: 2 }} />
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Votre pseudo sera visible par les autres utilisateurs du réseau.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PseudoConfig;
