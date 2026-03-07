import React, { useState } from "react";
import { updatePseudo } from "../shared";
import { Icons } from "./Icons";

interface WelcomeScreenProps {
  onComplete: () => void;
}

function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const [pseudo, setPseudo] = useState("");
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
    onComplete();
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Background Glow Effects */}
      <div
        className="fixed top-0 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-20"
        style={{ background: 'var(--accent-primary)' }}
      />
      <div
        className="fixed bottom-0 right-1/4 w-96 h-96 rounded-full blur-3xl opacity-10"
        style={{ background: 'var(--accent-warm)' }}
      />

      <div className="glass-card p-8 max-w-md w-full relative animate-fade-in">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
              boxShadow: '0 0 40px rgba(16, 185, 129, 0.4)'
            }}
          >
            <Icons.Broadcast size={40} className="text-white" />
          </div>
        </div>

        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            Bienvenue
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Choisissez votre pseudo pour commencer à diffuser
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="pseudo"
              className="block text-sm font-medium mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              Votre pseudo
            </label>
            <input
              id="pseudo"
              type="text"
              value={pseudo}
              onChange={(e) => {
                setPseudo(e.target.value);
                setError("");
              }}
              placeholder="Entrez votre pseudo..."
              className="input-dark w-full text-lg"
              style={{ padding: '16px 20px' }}
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

          <button
            type="submit"
            className="btn-primary w-full text-lg"
            style={{ padding: '16px 24px' }}
          >
            Commencer
          </button>
        </form>

        <p
          className="text-center text-xs mt-6"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Vous pourrez modifier votre pseudo plus tard dans les paramètres
        </p>
      </div>
    </div>
  );
}

export default WelcomeScreen;
