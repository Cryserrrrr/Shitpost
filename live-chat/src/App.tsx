import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { SHARED_CONFIG } from "./shared";
import { SOCKET_CONFIG } from "./constants";
import WelcomeScreen from "./components/WelcomeScreen";
import PseudoConfig from "./components/PseudoConfig";

const TIMEOUT_LIMITS = {
  min: 1000,
  max: 30000,
  step: 1000,
} as const;

interface MediaData {
  type: "image" | "video";
  data: string;
  mimeType: string;
}

interface Client {
  id: string;
  name: string;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [mediaData, setMediaData] = useState<MediaData | null>(null);
  const [textData, setTextData] = useState<{
    topText: string;
    bottomText: string;
  }>({
    topText: "",
    bottomText: "",
  });
  const [previewWithText, setPreviewWithText] = useState<string | null>(null);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem("tauri-welcome-completed");
  });
  const [showConfig, setShowConfig] = useState(false);
  const [activeTab, setActiveTab] = useState<"media" | "settings">("media");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const topTextInputRef = useRef<HTMLInputElement>(null);
  const bottomTextInputRef = useRef<HTMLInputElement>(null);

  const setupSocketListeners = useCallback((newSocket: Socket) => {
    newSocket.on("connect", () => {
      console.log("App connected to server");
      newSocket.emit("register", {
        machineId: SHARED_CONFIG.machineId,
        name: SHARED_CONFIG.pseudo,
      });
    });

    newSocket.on("presence:list", (clients: Client[]) => {
      setClients(clients);
    });

    newSocket.on("presence:update", (client: Client) => {
      setClients((prev) => {
        const existing = prev.find((c) => c.id === client.id);
        if (existing) {
          return prev.map((c) => (c.id === client.id ? client : c));
        } else {
          return [...prev, client];
        }
      });
    });
  }, []);

  useEffect(() => {
    const newSocket = io(SHARED_CONFIG.serverUrl, SOCKET_CONFIG);
    setSocket(newSocket);
    setupSocketListeners(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [setupSocketListeners]);

  const createMediaWithText = useCallback(
    async (mediaData: any, textData: any) => {
      if (!textData.topText && !textData.bottomText) {
        return mediaData.data.split(",")[1];
      }

      if (mediaData.type === "image") {
        return new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(mediaData.data.split(",")[1]);
              return;
            }

            canvas.width = img.width;
            canvas.height = img.height;

            ctx.drawImage(img, 0, 0);

            if (textData.topText || textData.bottomText) {
              ctx.font = "bold 32px Impact, Charcoal, sans-serif";
              ctx.textAlign = "center";
              ctx.strokeStyle = "#000000";
              ctx.lineWidth = 1;
              ctx.fillStyle = "#ffffff";

              if (textData.topText) {
                const topText = textData.topText.toUpperCase();
                const x = canvas.width / 2;
                const y = 40;

                ctx.strokeText(topText, x, y);
                ctx.fillText(topText, x, y);
              }

              if (textData.bottomText) {
                const bottomText = textData.bottomText.toUpperCase();
                const x = canvas.width / 2;
                const y = canvas.height - 30;

                ctx.strokeText(bottomText, x, y);
                ctx.fillText(bottomText, x, y);
              }
            }

            const dataUrl = canvas.toDataURL("image/png", 1.0);
            resolve(dataUrl.split(",")[1]);
          };
          img.src = mediaData.data;
        });
      } else {
        // Pour les vidéos, on ne peut pas intégrer le texte directement
        // On retourne la vidéo originale et on enverra le texte séparément
        return mediaData.data.split(",")[1];
      }
    },
    []
  );

  useEffect(() => {
    const updatePreview = async () => {
      if (
        mediaData &&
        mediaData.type === "image" &&
        (textData.topText || textData.bottomText)
      ) {
        const previewDataUrl = await createMediaWithText(mediaData, textData);
        setPreviewWithText(`data:image/png;base64,${previewDataUrl}`);
      } else if (mediaData) {
        setPreviewWithText(mediaData.data);
      } else {
        setPreviewWithText(null);
      }
    };

    updatePreview();
  }, [mediaData, textData, createMediaWithText]);

  const handleWelcomeComplete = useCallback(() => {
    localStorage.setItem("tauri-welcome-completed", "true");
    setShowWelcome(false);
  }, []);

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setMediaData({
          type: file.type.startsWith("image/") ? "image" : "video",
          data: result,
          mimeType: file.type,
        });
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handleSend = useCallback(async () => {
    if (!socket?.connected || selectedClients.length === 0) return;

    if (mediaData) {
      const mediaBuffer = await createMediaWithText(mediaData, textData);
      const payload = {
        targetIds: selectedClients,
        mediaType: mediaData.type,
        mediaBuffer,
        mimeType: mediaData.type === "image" ? "image/png" : mediaData.mimeType,
        duration: timeoutMs,
        textOverlay:
          textData.topText || textData.bottomText
            ? {
                topText: textData.topText,
                bottomText: textData.bottomText,
              }
            : undefined,
      };

      socket.emit("broadcast_media", payload);
    } else if (textData.topText || textData.bottomText) {
      const payload = {
        targetIds: selectedClients,
        mediaType: "text",
        text: textData.topText || textData.bottomText,
        position: "top",
        fontSize: 24,
        color: "#ffffff",
        duration: timeoutMs,
      };

      socket.emit("broadcast_media", payload);
    }
  }, [
    socket,
    selectedClients,
    mediaData,
    textData,
    timeoutMs,
    createMediaWithText,
  ]);

  const handleClearMedia = useCallback(() => {
    setMediaData(null);
  }, []);

  const handleClientToggle = useCallback((clientId: string) => {
    setSelectedClients((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedClients(clients.map((c) => c.id));
  }, [clients]);

  const handleSelectNone = useCallback(() => {
    setSelectedClients([]);
  }, []);

  const handleClearMachineId = useCallback(() => {
    localStorage.removeItem("tauri-machine-id");
    localStorage.removeItem("tauri-welcome-completed");
    window.location.reload();
  }, []);

  if (showWelcome) {
    return <WelcomeScreen onComplete={handleWelcomeComplete} />;
  }

  if (showConfig) {
    return <PseudoConfig onClose={() => setShowConfig(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
      <header className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-white">Live Chat Studio</h1>
            <div className="flex items-center space-x-4">
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  socket?.connected
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-red-500/20 text-red-400 border border-red-500/30"
                }`}
              >
                {socket?.connected ? "Connecté" : "Déconnecté"}
              </span>
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-white/10 text-white">
                {SHARED_CONFIG.pseudo}
              </span>
            </div>
          </div>
        </div>
      </header>

      <nav className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-1">
            <button
              className={`px-6 py-4 text-sm font-medium transition-all duration-300 border-b-2 ${
                activeTab === "media"
                  ? "text-white border-white bg-white/10"
                  : "text-white/70 border-transparent hover:text-white hover:bg-white/5"
              }`}
              onClick={() => setActiveTab("media")}
            >
              📺 Média
            </button>
            <button
              className={`px-6 py-4 text-sm font-medium transition-all duration-300 border-b-2 ${
                activeTab === "settings"
                  ? "text-white border-white bg-white/10"
                  : "text-white/70 border-transparent hover:text-white hover:bg-white/5"
              }`}
              onClick={() => setActiveTab("settings")}
            >
              ⚙️ Paramètres
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === "media" && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl shadow-2xl p-6">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Média
                    </h3>
                    <div className="space-y-4">
                      <div className="flex space-x-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,video/*"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          📁 Choisir média
                        </button>
                        {mediaData && (
                          <button
                            onClick={handleClearMedia}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                          >
                            🗑️ Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Aperçu final
                    </h3>
                    <div
                      className="relative bg-gray-900 rounded-lg overflow-hidden"
                      style={{ aspectRatio: "16/9" }}
                    >
                      {previewWithText ? (
                        <>
                          {mediaData?.type === "image" && (
                            <img
                              src={previewWithText}
                              alt="Preview"
                              className="w-full h-full object-cover"
                            />
                          )}
                          {mediaData?.type === "video" && (
                            <div className="relative w-full h-full">
                              <video
                                src={previewWithText}
                                className="w-full h-full object-cover"
                                muted
                                loop
                                autoPlay
                              />
                              {textData.topText && (
                                <div
                                  className="absolute left-1/2 transform -translate-x-1/2 text-center px-4 py-2 max-w-[90%]"
                                  style={{
                                    top: "20px",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "24px",
                                      color: "#ffffff",
                                      fontWeight: "bold",
                                      fontFamily:
                                        "Impact, Charcoal, sans-serif",
                                      textShadow: `
                                         -3px -3px 0 #000,
                                         3px -3px 0 #000,
                                         -3px 3px 0 #000,
                                         3px 3px 0 #000,
                                         0px -3px 0 #000,
                                         0px 3px 0 #000,
                                         -3px 0px 0 #000,
                                         3px 0px 0 #000
                                       `,
                                    }}
                                  >
                                    {textData.topText.toUpperCase()}
                                  </div>
                                </div>
                              )}
                              {textData.bottomText && (
                                <div
                                  className="absolute left-1/2 transform -translate-x-1/2 text-center px-4 py-2 max-w-[90%]"
                                  style={{
                                    bottom: "20px",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "24px",
                                      color: "#ffffff",
                                      fontWeight: "bold",
                                      fontFamily:
                                        "Impact, Charcoal, sans-serif",
                                      textShadow: `
                                         -3px -3px 0 #000,
                                         3px -3px 0 #000,
                                         -3px 3px 0 #000,
                                         3px 3px 0 #000,
                                         0px -3px 0 #000,
                                         0px 3px 0 #000,
                                         -3px 0px 0 #000,
                                         3px 0px 0 #000
                                       `,
                                    }}
                                  >
                                    {textData.bottomText.toUpperCase()}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      ) : textData.topText || textData.bottomText ? (
                        <div className="w-full h-full flex items-center justify-center bg-gray-800">
                          <div className="text-center px-4 py-2 max-w-[90%]">
                            <div
                              style={{
                                fontSize: "24px",
                                color: "#ffffff",
                                fontWeight: "bold",
                                fontFamily: "Impact, Charcoal, sans-serif",
                                textShadow: `
                                  -3px -3px 0 #000,
                                  3px -3px 0 #000,
                                  -3px 3px 0 #000,
                                  3px 3px 0 #000,
                                  0px -3px 0 #000,
                                  0px 3px 0 #000,
                                  -3px 0px 0 #000,
                                  3px 0px 0 #000
                                `,
                              }}
                            >
                              {textData.topText || textData.bottomText}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-gray-400">
                          <div className="text-center">
                            <div className="text-4xl mb-2">📺</div>
                            <div>Aucun média sélectionné</div>
                            <div className="text-sm mt-1">
                              Ajoutez un média, enregistrez une vidéo ou du
                              texte pour voir l'aperçu
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Texte overlay
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Texte du haut
                        </label>
                        <input
                          ref={topTextInputRef}
                          type="text"
                          value={textData.topText}
                          onChange={(e) =>
                            setTextData((prev) => ({
                              ...prev,
                              topText: e.target.value,
                            }))
                          }
                          placeholder="Entrez votre texte du haut..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Texte du bas
                        </label>
                        <input
                          ref={bottomTextInputRef}
                          type="text"
                          value={textData.bottomText}
                          onChange={(e) =>
                            setTextData((prev) => ({
                              ...prev,
                              bottomText: e.target.value,
                            }))
                          }
                          placeholder="Entrez votre texte du bas..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Durée d'affichage (ms)
                    </label>
                    <input
                      type="number"
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(Number(e.target.value))}
                      min={TIMEOUT_LIMITS.min}
                      max={TIMEOUT_LIMITS.max}
                      step={TIMEOUT_LIMITS.step}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <button
                    onClick={handleSend}
                    disabled={
                      (!mediaData &&
                        !textData.topText &&
                        !textData.bottomText) ||
                      selectedClients.length === 0
                    }
                    className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-green-600 hover:to-green-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all duration-200 transform hover:-translate-y-0.5 disabled:transform-none"
                  >
                    📤 Envoyer ({selectedClients.length} client
                    {selectedClients.length > 1 ? "s" : ""})
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl shadow-2xl p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Clients connectés ({clients.length})
                </h3>
                <div className="flex space-x-2 mb-4">
                  <button
                    onClick={handleSelectAll}
                    className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                  >
                    Tout
                  </button>
                  <button
                    onClick={handleSelectNone}
                    className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                  >
                    Aucun
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {clients.map((client) => (
                    <div
                      key={client.id}
                      className="py-2 border-b border-gray-100 last:border-b-0"
                    >
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedClients.includes(client.id)}
                          onChange={() => handleClientToggle(client.id)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-gray-700">
                          {client.name || client.id}
                        </span>
                      </label>
                    </div>
                  ))}
                  {clients.length === 0 && (
                    <p className="text-center text-gray-500 italic py-4">
                      Aucun client connecté
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl shadow-2xl p-8">
              <div className="space-y-8">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">
                    Configuration du profil
                  </h3>
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Pseudo actuel
                      </label>
                      <span className="text-sm text-gray-900 font-mono">
                        {SHARED_CONFIG.pseudo}
                      </span>
                    </div>
                    <button
                      onClick={() => setShowConfig(true)}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                    >
                      Modifier
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">
                    Informations système
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <label className="text-sm font-medium text-gray-700">
                        Machine ID
                      </label>
                      <span className="text-sm text-gray-900 font-mono">
                        {SHARED_CONFIG.machineId}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <label className="text-sm font-medium text-gray-700">
                        Serveur
                      </label>
                      <span className="text-sm text-gray-900 font-mono">
                        {SHARED_CONFIG.serverUrl}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <label className="text-sm font-medium text-gray-700">
                        Socket ID
                      </label>
                      <span className="text-sm text-gray-900 font-mono">
                        {socket?.id || "N/A"}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">
                    Actions système
                  </h3>
                  <button
                    onClick={handleClearMachineId}
                    className="w-full bg-red-600 text-white font-medium py-3 px-6 rounded-lg hover:bg-red-700 transition-all duration-200 transform hover:-translate-y-0.5"
                  >
                    🔄 Réinitialiser Machine ID
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
