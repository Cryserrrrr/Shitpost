import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useLang } from "../contexts/LangContext";
import { Icons } from "./Icons";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "installing" | "done" | "error";

export default function Updater() {
  const { t } = useLang();
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    checkForUpdate();
  }, []);

  async function checkForUpdate() {
    try {
      setStatus("checking");
      const found = await check();
      if (found) {
        setUpdate(found);
        setStatus("available");
      } else {
        setStatus("done");
      }
    } catch {
      setStatus("error");
    }
  }

  async function downloadAndInstall() {
    if (!update) return;
    try {
      setStatus("downloading");
      let totalBytes = 0;
      let downloadedBytes = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === "Finished") {
          setStatus("installing");
        }
      });
      setStatus("installing");
    } catch (err: any) {
      console.error("Update error:", err);
      setErrorMsg(String(err?.message || err));
      setStatus("error");
    }
  }

  async function handleRestart() {
    await relaunch();
  }

  // Don't show anything if dismissed, idle, or up to date
  if (dismissed || status === "idle" || status === "done") return null;
  // Brief checking state - don't show if no update found quickly
  if (status === "checking") return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        background: "var(--bg-card)",
        border: "3px solid var(--border-dark)",
        borderRadius: 16,
        boxShadow: "var(--shadow-cartoon)",
        padding: "16px 20px",
        minWidth: 280,
        maxWidth: 340,
        fontFamily: "'Nunito', sans-serif",
      }}
    >
      {status === "available" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Icons.Download size={20} style={{ color: "var(--accent-cyan)" }} />
            <span className="font-cartoon" style={{ color: "var(--accent-cyan)", fontWeight: 700, fontSize: 15 }}>
              {t("updater.available")}
            </span>
          </div>
          {update?.version && (
            <div style={{ color: "var(--text-gray)", fontSize: 13, marginBottom: 12 }}>
              v{update.version}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={downloadAndInstall}
              style={{
                flex: 1,
                padding: "8px 0",
                background: "var(--accent-cyan)",
                color: "#000",
                border: "2px solid var(--border-dark)",
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                boxShadow: "var(--shadow-cartoon-sm)",
                fontFamily: "'Fredoka', sans-serif",
              }}
            >
              {t("updater.downloading").replace("...", "")}
            </button>
            <button
              onClick={() => setDismissed(true)}
              style={{
                padding: "8px 14px",
                background: "var(--bg-input)",
                color: "var(--text-gray)",
                border: "2px solid var(--border-dark)",
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                boxShadow: "var(--shadow-cartoon-sm)",
              }}
            >
              {t("updater.later")}
            </button>
          </div>
        </>
      )}

      {(status === "downloading") && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Icons.Download size={20} className="animate-pulse" style={{ color: "var(--accent-yellow)" }} />
            <span style={{ color: "var(--accent-yellow)", fontWeight: 700, fontSize: 14 }}>
              {t("updater.downloading")} {progress > 0 ? `${progress}%` : ""}
            </span>
          </div>
          <div style={{
            width: "100%",
            height: 8,
            background: "var(--bg-input)",
            borderRadius: 4,
            border: "2px solid var(--border-dark)",
            overflow: "hidden",
          }}>
            <div style={{
              width: `${progress}%`,
              height: "100%",
              background: "var(--accent-cyan)",
              borderRadius: 2,
              transition: "width 0.3s",
            }} />
          </div>
        </>
      )}

      {status === "installing" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--accent-green)", fontWeight: 700, fontSize: 14 }}>
            {t("updater.installing")}
          </span>
          <button
            onClick={handleRestart}
            style={{
              width: "100%",
              padding: "10px 0",
              background: "var(--accent-green)",
              color: "#000",
              border: "2px solid var(--border-dark)",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              boxShadow: "var(--shadow-cartoon-sm)",
              fontFamily: "'Fredoka', sans-serif",
            }}
          >
            {t("updater.restart")}
          </button>
        </div>
      )}

      {status === "error" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent-red)", fontWeight: 600, fontSize: 13 }}>
            {t("updater.error")}
          </span>
          <button
            onClick={() => setDismissed(true)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            x
          </button>
          </div>
          {errorMsg && (
            <div style={{ color: "var(--text-muted)", fontSize: 11, wordBreak: "break-all" }}>
              {errorMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
