import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { SHARED_CONFIG } from "./shared";
import { SOCKET_CONFIG } from "./constants";
import "./overlay.css";

interface OverlayData {
  b64: string;
  timeoutMs: number;
}

interface MediaData {
  mediaType: "image" | "video" | "text";
  mediaBuffer?: string;
  mimeType?: string;
  duration: number;
  text?: string;
  position?: "top" | "bottom";
  fontSize?: number;
  color?: string;
  textOverlay?: {
    topText: string;
    bottomText: string;
  };
}

function Overlay() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [textPosition, setTextPosition] = useState<"top" | "bottom">("bottom");
  const [textStyle, setTextStyle] = useState({
    fontSize: 24,
    color: "#ffffff",
  });
  const [topText, setTopText] = useState<string | null>(null);
  const [bottomText, setBottomText] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState(0);
  const [videoKey, setVideoKey] = useState<string>("");
  const [videoTimestamp, setVideoTimestamp] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");
  const [lastReceivedData, setLastReceivedData] = useState<string>("None");
  const [lastEvent, setLastEvent] = useState<string>("None");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  const setupSocketListeners = useCallback((newSocket: Socket) => {
    newSocket.on("connect", () => {
      console.log("Overlay connected to server");
      console.log("Overlay socket ID:", newSocket.id);
      setConnectionStatus("Connected");
      setLastEvent("connect");
      // L'overlay ne s'enregistre pas comme un client distinct
      // Il écoute seulement les événements de média
      console.log("Overlay connected as media receiver only");
    });

    newSocket.on("disconnect", () => {
      console.log("Overlay disconnected from server");
      setConnectionStatus("Disconnected");
      setLastEvent("disconnect");
    });

    newSocket.on("connect_error", (error) => {
      console.error("Overlay connection error:", error);
      setConnectionStatus(`Connection Error: ${error.message}`);
      setLastEvent(`connect_error: ${error.message}`);
    });

    newSocket.on("overlay:image", (data: OverlayData) => {
      console.log("Overlay received overlay:image event:", data);
      setLastEvent("overlay:image");
      setLastReceivedData(
        `Received: b64=${data.b64?.substring(0, 20)}..., timeout=${
          data.timeoutMs
        }`
      );

      if (!data.b64 || data.b64.trim() === "") {
        setLastReceivedData("Error: Empty b64 data");
        console.error("Empty b64 data received");
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const imageUrl = `data:image/png;base64,${data.b64}`;
      setCurrentImage(imageUrl);
      setCurrentVideo(null);
      setCurrentText(null);
      setImageKey((prev) => prev + 1);
      setLastReceivedData(`Image set: ${imageUrl.substring(0, 50)}...`);

      timeoutRef.current = setTimeout(() => {
        setCurrentImage(null);
        setLastReceivedData("Image hidden after timeout");
      }, data.timeoutMs || 5000);
    });

    newSocket.on("media:show", (data: MediaData) => {
      console.log("Overlay received media:show event:", data);
      console.log("Media data details:", {
        mediaType: data.mediaType,
        bufferLength: data.mediaBuffer?.length || 0,
        mimeType: data.mimeType,
        duration: data.duration,
        text: data.text,
        textOverlay: data.textOverlay,
      });
      console.log("Full media data received:", JSON.stringify(data, null, 2));
      setLastEvent("media:show");
      setLastReceivedData(
        `Received: mediaType=${data.mediaType}, duration=${
          data.duration
        }, mimeType=${data.mimeType || "undefined"}`
      );

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        console.log("Cleared previous timeout");
      }

      // Clear previous media and text
      setCurrentImage(null);
      setCurrentVideo(null);
      setCurrentText(null);
      setTopText(null);
      setBottomText(null);

      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
      }

      if (data.mediaType === "text") {
        console.log("Processing text media type");
        if (!data.text) {
          setLastReceivedData("Error: Empty text data");
          console.error("Empty text data received");
          return;
        }

        setCurrentText(data.text);
        setTextPosition(data.position || "bottom");
        setTextStyle({
          fontSize: data.fontSize || 24,
          color: data.color || "#ffffff",
        });
        setLastReceivedData(`Text set: ${data.text.substring(0, 50)}...`);

        timeoutRef.current = setTimeout(() => {
          setCurrentText(null);
          setLastReceivedData("Text hidden after timeout");
        }, data.duration || 5000);
      } else if (data.mediaType === "video") {
        console.log("Processing video media type");
        if (!data.mediaBuffer || data.mediaBuffer.trim() === "") {
          setLastReceivedData("Error: Empty media buffer");
          console.error("Empty media buffer received");
          return;
        }

        const mimeType = data.mimeType || "video/mp4";
        const supportedMimeTypes = [
          "video/mp4",
          "video/webm",
          "video/ogg",
          "video/quicktime",
          "video/x-msvideo",
          "video/x-matroska",
        ];

        const finalMimeType = supportedMimeTypes.includes(mimeType)
          ? mimeType
          : "video/mp4";

        const videoUrl = `data:${finalMimeType};base64,${data.mediaBuffer}`;
        const newVideoKey = `video-${Date.now()}-${Math.random()}`;
        const newTimestamp = Date.now();

        setTimeout(() => {
          setCurrentVideo(videoUrl);
          setVideoKey(newVideoKey);
          setVideoTimestamp(newTimestamp);
          setLastReceivedData(
            `Video set: ${videoUrl.substring(
              0,
              50
            )}... (MIME: ${finalMimeType})`
          );
        }, 100);

        timeoutRef.current = setTimeout(() => {
          setCurrentVideo(null);
          setTopText(null);
          setBottomText(null);
          setLastReceivedData("Video hidden after timeout");
        }, data.duration || 5000);
      } else if (data.mediaType === "image") {
        console.log("Processing image media type");
        if (!data.mediaBuffer || data.mediaBuffer.trim() === "") {
          setLastReceivedData("Error: Empty media buffer");
          console.error("Empty media buffer received");
          return;
        }

        const mimeType = data.mimeType || "image/png";

        try {
          const binaryString = atob(data.mediaBuffer);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: mimeType });
          const blobUrl = URL.createObjectURL(blob);
          currentBlobUrlRef.current = blobUrl;

          setTimeout(() => {
            setCurrentImage(blobUrl);
            setImageKey((prev) => prev + 1);
            setLastReceivedData(`Image set: ${blobUrl.substring(0, 50)}...`);
          }, 100);
        } catch (error) {
          console.error("Error creating image blob URL:", error);
          const imageUrl = `data:${mimeType};base64,${data.mediaBuffer}`;
          setTimeout(() => {
            setCurrentImage(imageUrl);
            setImageKey((prev) => prev + 1);
            setLastReceivedData(`Image set: ${imageUrl.substring(0, 50)}...`);
          }, 100);
        }

        timeoutRef.current = setTimeout(() => {
          setCurrentImage(null);
          setTopText(null);
          setBottomText(null);
          setLastReceivedData("Image hidden after timeout");
        }, data.duration || 5000);
      }

      // Process text overlay separately from media
      if (data.textOverlay) {
        console.log("Processing text overlay:", data.textOverlay);
        const textOverlay = data.textOverlay;
        setTimeout(() => {
          setTopText(textOverlay.topText || null);
          setBottomText(textOverlay.bottomText || null);
          setLastReceivedData(
            `Text overlay set: ${textOverlay.topText || ""} / ${
              textOverlay.bottomText || ""
            }`
          );
        }, 200);
      }
    });

    newSocket.onAny((eventName, ...args) => {
      if (eventName !== "connect" && eventName !== "disconnect") {
        console.log("Overlay received event:", eventName, args);
        setLastEvent(
          `${eventName}: ${JSON.stringify(args).substring(0, 50)}...`
        );
      }
    });
  }, []);

  useEffect(() => {
    setConnectionStatus("Initializing...");
    const newSocket = io(SHARED_CONFIG.serverUrl, SOCKET_CONFIG);
    setSocket(newSocket);
    setupSocketListeners(newSocket);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
      newSocket.disconnect();
    };
  }, [setupSocketListeners]);

  useEffect(() => {
    console.log(
      "Text state changed - topText:",
      topText,
      "bottomText:",
      bottomText
    );
  }, [topText, bottomText]);

  if (!SHARED_CONFIG.isDev) {
    return (
      <div className="overlay-container">
        {currentImage && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              pointerEvents: "none",
              zIndex: 9999,
            }}
          >
            <img
              key={imageKey}
              src={currentImage}
              alt="Overlay"
              className="overlay-image"
              style={{
                maxWidth: "100vw",
                maxHeight: "100vh",
                width: "auto",
                height: "auto",
                objectFit: "contain",
              }}
            />
          </div>
        )}
        {currentVideo && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              pointerEvents: "none",
              zIndex: 9999,
            }}
          >
            <video
              key={`${videoKey}-${videoTimestamp}`}
              src={currentVideo}
              autoPlay
              muted
              loop={false}
              className="overlay-video"
              style={{
                maxWidth: "100vw",
                maxHeight: "100vh",
                width: "auto",
                height: "auto",
                objectFit: "contain",
              }}
              onLoadStart={() => setLastReceivedData("Video loading started")}
              onCanPlay={() => setLastReceivedData("Video can play")}
              onPlay={() => setLastReceivedData("Video playing")}
              onError={(e) => {
                const error = e.currentTarget.error;
                const errorMessage = error
                  ? `Code: ${error.code}, Message: ${error.message}`
                  : "Unknown error";
                console.error("Video error:", errorMessage);
                setLastReceivedData(`Video error: ${errorMessage}`);
              }}
            />
          </div>
        )}
        {currentText && (
          <div
            style={{
              position: "fixed",
              top: textPosition === "top" ? "20px" : "auto",
              bottom: textPosition === "bottom" ? "20px" : "auto",
              left: "50%",
              transform: "translateX(-50%)",
              pointerEvents: "none",
              zIndex: 10000,
              textAlign: "center",
              padding: "10px 20px",
              maxWidth: "80vw",
            }}
          >
            <div
              style={{
                fontSize: `${textStyle.fontSize}px`,
                color: textStyle.color,
                fontWeight: "bold",
                textShadow: `
                  -2px -2px 0 #000,
                  2px -2px 0 #000,
                  -2px 2px 0 #000,
                  2px 2px 0 #000,
                  0px -2px 0 #000,
                  0px 2px 0 #000,
                  -2px 0px 0 #000,
                  2px 0px 0 #000
                `,
              }}
            >
              {currentText}
            </div>
          </div>
        )}
        {topText && (
          <div
            style={{
              position: "fixed",
              top: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              pointerEvents: "none",
              zIndex: 10000,
              textAlign: "center",
              padding: "10px 20px",
              maxWidth: "80vw",
            }}
          >
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
                  3px 0px 0 #000,
                  -2px -2px 0 #000,
                  2px -2px 0 #000,
                  -2px 2px 0 #000,
                  2px 2px 0 #000,
                  0px -2px 0 #000,
                  0px 2px 0 #000,
                  -2px 0px 0 #000,
                  2px 0px 0 #000
                `,
              }}
            >
              {topText.toUpperCase()}
            </div>
          </div>
        )}
        {bottomText && (
          <div
            style={{
              position: "fixed",
              bottom: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              pointerEvents: "none",
              zIndex: 10000,
              textAlign: "center",
              padding: "10px 20px",
              maxWidth: "80vw",
            }}
          >
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
                  3px 0px 0 #000,
                  -2px -2px 0 #000,
                  2px -2px 0 #000,
                  -2px 2px 0 #000,
                  2px 2px 0 #000,
                  0px -2px 0 #000,
                  0px 2px 0 #000,
                  -2px 0px 0 #000,
                  2px 0px 0 #000
                `,
              }}
            >
              {bottomText.toUpperCase()}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overlay-container">
      {currentImage && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <img
            key={imageKey}
            src={currentImage}
            alt="Overlay"
            className="overlay-image"
            style={{
              maxWidth: "100vw",
              maxHeight: "100vh",
              width: "auto",
              height: "auto",
              objectFit: "contain",
            }}
          />
        </div>
      )}
      {currentVideo && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <video
            key={`${videoKey}-${videoTimestamp}`}
            src={currentVideo}
            autoPlay
            muted
            loop={false}
            className="overlay-video"
            style={{
              maxWidth: "100vw",
              maxHeight: "100vh",
              width: "auto",
              height: "auto",
              objectFit: "contain",
            }}
            onLoadStart={() => setLastReceivedData("Video loading started")}
            onCanPlay={() => setLastReceivedData("Video can play")}
            onPlay={() => setLastReceivedData("Video playing")}
            onError={(e) => {
              const error = e.currentTarget.error;
              const errorMessage = error
                ? `Code: ${error.code}, Message: ${error.message}`
                : "Unknown error";
              console.error("Video error:", errorMessage);
              setLastReceivedData(`Video error: ${errorMessage}`);
            }}
          />
        </div>
      )}
      {currentText && (
        <div
          style={{
            position: "fixed",
            top: textPosition === "top" ? "20px" : "auto",
            bottom: textPosition === "bottom" ? "20px" : "auto",
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 10000,
            textAlign: "center",
            padding: "10px 20px",
            maxWidth: "80vw",
          }}
        >
          <div
            style={{
              fontSize: `${textStyle.fontSize}px`,
              color: textStyle.color,
              fontWeight: "bold",
              textShadow: `
                -2px -2px 0 #000,
                2px -2px 0 #000,
                -2px 2px 0 #000,
                2px 2px 0 #000,
                0px -2px 0 #000,
                0px 2px 0 #000,
                -2px 0px 0 #000,
                2px 0px 0 #000
              `,
            }}
          >
            {currentText}
          </div>
        </div>
      )}
      {topText && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 10000,
            textAlign: "center",
            padding: "10px 20px",
            maxWidth: "80vw",
          }}
        >
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
                3px 0px 0 #000,
                -2px -2px 0 #000,
                2px -2px 0 #000,
                -2px 2px 0 #000,
                2px 2px 0 #000,
                0px -2px 0 #000,
                0px 2px 0 #000,
                -2px 0px 0 #000,
                2px 0px 0 #000
              `,
            }}
          >
            {topText.toUpperCase()}
          </div>
        </div>
      )}
      {bottomText && (
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 10000,
            textAlign: "center",
            padding: "10px 20px",
            maxWidth: "80vw",
          }}
        >
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
                3px 0px 0 #000,
                -2px -2px 0 #000,
                2px -2px 0 #000,
                -2px 2px 0 #000,
                2px 2px 0 #000,
                0px -2px 0 #000,
                0px 2px 0 #000,
                -2px 0px 0 #000,
                2px 0px 0 #000
              `,
            }}
          >
            {bottomText.toUpperCase()}
          </div>
        </div>
      )}

      <div className="fixed top-4 left-4 bg-black/80 text-white p-4 rounded-lg font-mono text-sm z-50 max-w-md">
        <div>Machine ID: {SHARED_CONFIG.machineId}</div>
        <div>Pseudo: {SHARED_CONFIG.pseudo}</div>
        <div>Server URL: {SHARED_CONFIG.serverUrl}</div>
        <div>Socket ID: {socket?.id || "N/A"}</div>
        <div>Status: {connectionStatus}</div>
        <div>Connected: {socket?.connected ? "Yes" : "No"}</div>
        <div>Image: {currentImage ? "Displayed" : "None"}</div>
        <div>Video: {currentVideo ? "Displayed" : "None"}</div>
        <div>Text: {currentText ? "Displayed" : "None"}</div>
        <div>Top Text: {topText ? "Displayed" : "None"}</div>
        <div>Bottom Text: {bottomText ? "Displayed" : "None"}</div>
        <div>Last Event: {lastEvent}</div>
        <div>Last Data: {lastReceivedData}</div>
      </div>
    </div>
  );
}

export default Overlay;
