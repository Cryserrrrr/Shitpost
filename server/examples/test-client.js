const { io } = require("socket.io-client");

const socket = io("http://localhost:3000");

socket.emit("register", { machineId: "TEST-WORKSTATION-001" });

socket.on("registered", (data) => {
  // Registration successful
});

socket.on("media:show", (payload) => {
  // Handle media display here
  // For images: payload.mediaBuffer contains the image data
  // For videos: payload.mediaBuffer contains the video data
});

socket.on("broadcast_sent", (data) => {
  // Broadcast successful
});

socket.on("error", (error) => {
  // Handle error
});

setTimeout(() => {
  const testImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  socket.emit("broadcast_media", {
    type: "broadcast_media",
    payload: {
      targetIds: ["TEST-WORKSTATION-001"],
      mediaType: "image",
      mediaBuffer: testImage,
      duration: 5,
    },
  });
}, 2000);

socket.on("connect", () => {
  // Connected to server
});

socket.on("disconnect", () => {
  // Disconnected from server
});

process.on("SIGINT", () => {
  socket.disconnect();
  process.exit(0);
});
