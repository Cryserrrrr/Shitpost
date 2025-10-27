# Live Chat Server

A Node.js TypeScript server with Socket.io for real-time media broadcasting to Windows clients.

## Features

- WebSocket connections for real-time communication
- Client registration with unique machine IDs
- Media broadcasting (images/videos) to specific target clients
- In-memory client management (no file storage)
- HTTP API for client listing
- TypeScript with full type safety

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm start
```

## API Endpoints

### HTTP Endpoints

- `GET /clients` - Get list of connected clients
- `GET /health` - Health check

### WebSocket Events

#### Client Events (emit to server)

- `register` - Register client with machine ID

  ```typescript
  {
    machineId: string;
  }
  ```

- `broadcast_media` - Broadcast media to target clients
  ```typescript
  {
    type: 'broadcast_media',
    payload: {
      targetIds: string[],
      mediaType: 'image' | 'video',
      mediaBuffer: Buffer | string, // Buffer or base64
      duration: number // seconds
    }
  }
  ```

#### Server Events (received by client)

- `registered` - Confirmation of successful registration
- `media:show` - Media display instruction
- `broadcast_sent` - Confirmation of media broadcast
- `error` - Error messages

## Usage Example

### Client Connection (JavaScript/TypeScript)

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

// Register with machine ID
socket.emit("register", { machineId: "WORKSTATION-001" });

// Listen for media show events
socket.on("media:show", (payload) => {
  console.log("Display media:", payload);
  // Handle media display logic here
});

// Broadcast media to specific clients
socket.emit("broadcast_media", {
  type: "broadcast_media",
  payload: {
    targetIds: ["WORKSTATION-001", "WORKSTATION-002"],
    mediaType: "image",
    mediaBuffer: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    duration: 10,
  },
});
```

### Check Connected Clients

```bash
curl http://localhost:3000/clients
```

Response:

```json
{
  "count": 2,
  "clients": [
    {
      "machineId": "WORKSTATION-001",
      "socketId": "abc123",
      "connectedAt": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

## Architecture

- **ClientManager**: In-memory client management with socket tracking
- **TypeScript Interfaces**: Full type safety for all messages and data structures
- **Express Server**: HTTP endpoints for client management
- **Socket.io**: Real-time WebSocket communication
- **CORS**: Cross-origin support for web clients

## Notes

- All media is handled in memory (no file storage)
- Clients with duplicate machine IDs will disconnect the previous connection
- Media buffers can be sent as Buffer objects or base64 strings
- Server automatically validates all incoming messages
