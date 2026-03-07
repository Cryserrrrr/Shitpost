import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LangContext";
import api from "../services/api";
import { Icons } from "../components/Icons";
import Titlebar from "../components/Titlebar";

const RegisterPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    if (username.length < 2 || username.length > 20) {
      setError(t("auth.username_length"));
      setIsSubmitting(false);
      return;
    }

    if (password.length < 6) {
      setError(t("auth.password_length"));
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await api.post("/auth/register", { username, password });
      login(response.data.token, response.data.user, response.data.refreshToken);
      navigate("/");
    } catch (err: any) {
      setError(err.response?.data?.message || t("auth.register_error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-dark)" }}>
      <Titlebar />
      <div
        className="flex-1 flex items-center justify-center p-4 relative overflow-hidden"
      >
      {/* Background blobs */}
      <div
        className="fixed top-[-100px] right-[-100px] w-[400px] h-[400px] rounded-full opacity-20 blur-3xl"
        style={{ background: "var(--accent-cyan)" }}
      />
      <div
        className="fixed bottom-[-100px] left-[-100px] w-[400px] h-[400px] rounded-full opacity-15 blur-3xl"
        style={{ background: "var(--accent-purple)" }}
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-5 blur-3xl"
        style={{ background: "var(--accent-yellow)" }}
      />

      <div className="cartoon-card p-8 max-w-md w-full relative animate-bounce-in">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center animate-wiggle"
            style={{
              background: "linear-gradient(135deg, var(--accent-cyan), var(--accent-blue, #2de2e6))",
              border: "3px solid #000",
              boxShadow: "var(--shadow-cartoon)",
            }}
          >
            <Icons.Zap size={40} className="text-white" />
          </div>
        </div>

        <div className="text-center mb-8">
          <h1
            className="text-3xl font-cartoon mb-2"
            style={{ color: "var(--text-white)" }}
          >
            {t("auth.join_title")}
          </h1>
          <p style={{ color: "var(--text-gray)" }}>
            {t("auth.join_subtitle")}
          </p>
        </div>

        {error && (
          <div
            className="mb-5 p-3 rounded-xl text-sm text-center font-bold animate-bounce-in"
            style={{
              background: "rgba(255,71,87,0.1)",
              border: "2px solid var(--accent-red)",
              color: "var(--accent-red)",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold mb-1 block" style={{ color: "var(--text-muted)" }}>
              {t("auth.username")}
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="cartoon-input w-full"
              placeholder="TonPseudo"
              maxLength={20}
            />
          </div>

          <div>
            <label className="text-xs font-bold mb-1 block" style={{ color: "var(--text-muted)" }}>
              {t("auth.password")}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="cartoon-input w-full"
              placeholder={t("auth.password_placeholder")}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="cartoon-btn w-full py-3.5 text-lg mt-2"
            style={{
              background: "linear-gradient(135deg, var(--accent-cyan), var(--accent-green))",
              color: "#000",
            }}
          >
            {isSubmitting ? (
              <span className="inline-block animate-spin">~</span>
            ) : (
              t("auth.register")
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm" style={{ color: "var(--text-gray)" }}>
          {t("auth.has_account")}{" "}
          <Link
            to="/login"
            className="font-bold underline-offset-4 hover:underline transition-all"
            style={{ color: "var(--accent-pink)" }}
          >
            {t("auth.login_link")}
          </Link>
        </p>
      </div>
      </div>
    </div>
  );
};

export default RegisterPage;
