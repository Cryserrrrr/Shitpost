import React, { useState } from "react";
import { updatePseudo } from "../shared";

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
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Bienvenue dans Meme Studio
          </h1>
          <p className="text-gray-600">
            Choisissez votre pseudo pour commencer
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="pseudo"
              className="block text-sm font-medium text-gray-700 mb-2"
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
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
              maxLength={20}
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <p className="mt-1 text-xs text-gray-500">
              {pseudo.length}/20 caractères
            </p>
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 transform hover:-translate-y-0.5"
          >
            Commencer
          </button>
        </form>
      </div>
    </div>
  );
}

export default WelcomeScreen;
