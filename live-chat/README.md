# Shitpost Client

Tauri v2 + React desktop app for sending memes to friends' screens in real-time.

## Features

### Media
- Send images, videos and audio to friends
- Video compression (FFmpeg via Tauri sidecar)
- Video trimming with multi-segment selection and looping
- Audio overlay on images with volume and trim controls
- Text overlays (top/bottom) with configurable font size and position
- Drag & drop file support

### Social
- Friend system with username search and invite codes (`#CODE`)
- Groups with roles (owner, admin, member) and invite codes
- Real-time presence (online/offline/DND)
- User blocking (blocks friend requests, group invites and media)
- Pending friend/group request notifications

### Overlay
- Transparent, click-through overlay window (always on top)
- Multi-monitor support with screen selector
- Configurable volume for received media
- Smooth enter/exit animations

### History & Library
- Send/receive history stored locally (IndexedDB)
- History download (images and videos)
- Local memes library with auto-save
- Memes folder management (add/remove)

### Settings
- Server URL configuration (changeable anytime)
- Do Not Disturb mode
- Send to self toggle
- Volume control for received media
- Overlay monitor selector
- Auto-start with Windows
- Language selector (FR/EN)
- Blocked users management
- Account deletion

### Other
- Auto-updater (NSIS installer with `.sig` verification)
- System tray icon
- i18n (French / English)
- JWT auth with automatic token refresh

## Setup

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
# Output in src-tauri/target/release/bundle/
```

## Project Structure

```
src/
  App.tsx           # Main app (media picker, friends, groups, settings)
  overlay.tsx       # Overlay window (media display)
  App.css           # Styles
  i18n.ts           # Translations (FR/EN)
  contexts/
    AuthContext.tsx  # Auth state management
  services/
    api.ts          # Axios instance with token refresh interceptor
    historyDb.ts    # IndexedDB for send/receive history
    memesUtils.ts   # Local memes folder utilities
  components/
    Icons.tsx       # SVG icon components
    HistoryTab.tsx  # History tab component
    Updater.tsx     # Auto-updater notification
  pages/
    LoginPage.tsx   # Login page
    RegisterPage.tsx # Register page
src-tauri/
  src/
    lib.rs          # Tauri commands (autostart, monitors, compression)
  tauri.conf.json   # Tauri configuration
```

## Server Configuration

No `.env` needed. The server URL is configured at runtime in the app UI (login screen or Settings). Stored in `localStorage`.
