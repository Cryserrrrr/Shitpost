import React, { useState } from "react";
import { SHARED_CONFIG, updatePseudo } from "../shared";

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            Modifier le pseudo
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="pseudo-config"
              className="block text-sm font-medium text-gray-700 mb-2"
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
              placeholder="Entrez votre nouveau pseudo..."
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
              maxLength={20}
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <p className="mt-1 text-xs text-gray-500">
              {pseudo.length}/20 caractères
            </p>
          </div>

          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium py-2 px-4 rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200"
            >
              Sauvegarder
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PseudoConfig;
