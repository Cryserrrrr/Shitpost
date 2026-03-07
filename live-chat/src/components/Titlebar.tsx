import React from "react";
import { Icons } from "./Icons";

interface TitlebarProps {
  children?: React.ReactNode;
}

const Titlebar: React.FC<TitlebarProps> = ({ children }) => {
  const startDrag = () => {
    (window as any).__TAURI__?.window?.getCurrentWindow?.()?.startDragging?.();
  };

  const toggleMaximize = () => {
    const win = (window as any).__TAURI__?.window?.getCurrentWindow?.();
    if (win) win.isMaximized().then((max: boolean) => (max ? win.unmaximize() : win.maximize()));
  };

  return (
    <header
      className="flex items-center justify-between select-none shrink-0"
      style={{ background: "var(--bg-sidebar)", borderBottom: "3px solid #000", height: 42 }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        startDrag();
      }}
      onDoubleClick={toggleMaximize}
    >
      <div className="flex items-center gap-2 pl-4">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, var(--accent-pink), var(--accent-orange))",
            border: "2px solid #000",
          }}
        >
          <Icons.Broadcast size={14} className="text-white" />
        </div>
        <h1 className="text-sm font-cartoon" style={{ color: "var(--text-white)" }}>
          Shitpost
        </h1>
      </div>

      <div className="flex items-center gap-3 pr-1">
        {children}

        {/* Window controls */}
        <div className="flex" style={{ marginLeft: 8 }}>
          <button
            onClick={() => (window as any).__TAURI__?.window?.getCurrentWindow?.()?.minimize?.()}
            className="flex items-center justify-center hover:brightness-125"
            style={{ width: 36, height: 42, color: "var(--text-muted)" }}
          >
            <svg width="10" height="1"><rect width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button
            onClick={toggleMaximize}
            className="flex items-center justify-center hover:brightness-125"
            style={{ width: 36, height: 42, color: "var(--text-muted)" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>
          <button
            onClick={() => (window as any).__TAURI__?.window?.getCurrentWindow?.()?.hide?.()}
            className="flex items-center justify-center hover:bg-red-600"
            style={{ width: 36, height: 42, color: "var(--text-muted)" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Titlebar;
