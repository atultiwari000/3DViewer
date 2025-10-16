import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 100e6, // 100MB for large 3D models
  pingTimeout: 60000,
  pingInterval: 25000,
});

interface SceneState {
  model: string | null;
  modelMetadata: {
    name: string;
    size: number;
    type: string;
  } | null;
  transform: any | null;
  camera: any | null;
}

// In-memory store for scene states per room
const roomScenes: Record<string, SceneState> = {};

// Track which room each socket is in
const socketRooms: Record<string, string> = {};

// Track model upload progress
const uploadProgress: Record<string, { received: number; total: number }> = {};

io.on("connection", (socket: Socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  socket.on("join", (roomId: string) => {
    socket.join(roomId);
    socketRooms[socket.id] = roomId;
    console.log(`🚪 Socket ${socket.id} joined room ${roomId}`);

    // Initialize room if it doesn't exist
    if (!roomScenes[roomId]) {
      roomScenes[roomId] = {
        model: null,
        modelMetadata: null,
        transform: null,
        camera: null,
      };
      console.log(`🆕 Created new room: ${roomId}`);
    }

    // Send current scene state to the newly joined user
    const sceneState = roomScenes[roomId];
    if (sceneState.model) {
      console.log(`📤 Sending scene:init to ${socket.id}`, {
        hasModel: !!sceneState.model,
        modelSize: sceneState.model?.length || 0,
        hasTransform: !!sceneState.transform,
        hasCamera: !!sceneState.camera,
      });

      // Send model metadata first
      socket.emit("scene:model-incoming", {
        metadata: sceneState.modelMetadata,
        size: sceneState.model.length,
      });

      // Send the actual scene state
      socket.emit("scene:init", {
        model: sceneState.model,
        transform: sceneState.transform,
        camera: sceneState.camera,
      });

      // Wait for acknowledgment
      socket.on("scene:init-ack", () => {
        console.log(`✅ Scene:init acknowledged by ${socket.id}`);
      });
    }

    // Notify other users in the room about the new user
    socket.to(roomId).emit("user-connected", socket.id);
    console.log(`📢 Notified room ${roomId} about new user ${socket.id}`);
  });

  // Handle scene actions - NOT nested inside join
  socket.on("scene:action", (action, callback) => {
    const roomId = socketRooms[socket.id];
    if (!roomId) {
      console.warn(`⚠️ Socket ${socket.id} not in any room`);
      if (callback) callback({ success: false, error: "Not in a room" });
      return;
    }

    console.log(`🎬 Scene action from ${socket.id} in room ${roomId}:`, action.type);

    try {
      switch (action.type) {
        case "loadModel":
          const modelData = action.payload;
          const metadata = action.metadata || {
            name: "unknown",
            size: modelData?.length || 0,
          };

          // Update server state
          roomScenes[roomId] = {
            model: modelData,
            modelMetadata: metadata,
            transform: null,
            camera: null,
          };

          console.log(
            `📦 Model stored in room ${roomId}:`,
            `Name: ${metadata.name},`,
            `Size: ${(metadata.size / 1024 / 1024).toFixed(2)}MB`,
            `From: ${socket.id}`
          );

          // Notify about incoming model (including sender for client-side filtering)
          io.in(roomId).emit("scene:model-incoming", {
            metadata,
            size: modelData.length,
            from: socket.id, // CRITICAL: Include sender ID
          });

          // Broadcast to ALL users in room (client will filter own messages)
          io.in(roomId).emit("scene:update", {
            action,
            from: socket.id, // CRITICAL: Include sender ID
          });

          if (callback) callback({ success: true });
          break;

        case "camera":
          if (roomScenes[roomId]) {
            roomScenes[roomId].camera = action.payload;
          }

          // Broadcast to ALL (client filters)
          io.in(roomId).emit("scene:update", {
            action,
            from: socket.id,
          });

          if (callback) callback({ success: true });
          break;

        case "transform":
          if (roomScenes[roomId]) {
            roomScenes[roomId].transform = action.payload;
          }

          // Broadcast to ALL (client filters)
          io.in(roomId).emit("scene:update", {
            action,
            from: socket.id,
          });

          if (callback) callback({ success: true });
          break;

        case "clear":
          roomScenes[roomId] = {
            model: null,
            modelMetadata: null,
            transform: null,
            camera: null,
          };

          console.log(`🧹 Scene cleared in room ${roomId} by ${socket.id}`);

          // Broadcast to ALL
          io.in(roomId).emit("scene:update", {
            action,
            from: socket.id,
          });

          if (callback) callback({ success: true });
          break;

        default:
          console.warn(`⚠️ Unknown action type: ${action.type}`);
          if (callback) callback({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error(`❌ Error processing scene action:`, error);
      if (callback) callback({ success: false, error: String(error) });
    }
  });


  // Handle gesture actions
  socket.on("gesture:action", (data: { gesture: string }) => {
    const roomId = socketRooms[socket.id];
    if (!roomId) return;

    console.log(
      `👋 Gesture from ${socket.id} in room ${roomId}:`,
      data.gesture
    );

    // Broadcast to ALL (client filters own messages)
    io.in(roomId).emit("gesture:action", {
      gesture: data.gesture,
      from: socket.id,
    });
  });

  // Handle model chunk upload (for very large files)
  socket.on(
    "scene:model-chunk",
    ({ chunk, index, total, roomId: chunkRoomId }) => {
      const key = `${socket.id}-${chunkRoomId}`;
      if (!uploadProgress[key]) {
        uploadProgress[key] = { received: 0, total };
      }
      uploadProgress[key].received = index + 1;

      console.log(`📦 Received chunk ${index + 1}/${total} from ${socket.id}`);

      // Acknowledge chunk
      socket.emit("scene:chunk-ack", { index });
    }
  );

  // Handle WebRTC signaling
  socket.on("signal", (data: { to: string; signal: any }) => {
    console.log(
      `📡 Signal from ${socket.id} to ${data.to}: ${
        data.signal.type || "candidate"
      }`
    );
    io.to(data.to).emit("signal", {
      from: socket.id,
      signal: data.signal,
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    const roomId = socketRooms[socket.id];
    console.log(
      `👋 Client disconnected: ${socket.id} from room ${roomId || "unknown"}`
    );

    if (roomId) {
      // Clean up upload progress
      Object.keys(uploadProgress).forEach((key) => {
        if (key.startsWith(socket.id)) {
          delete uploadProgress[key];
        }
      });

      // Notify other users
      socket.to(roomId).emit("user-disconnected", socket.id);

      // Clean up room tracking
      delete socketRooms[socket.id];

      // Clean up room if empty
      io.in(roomId)
        .allSockets()
        .then((clients) => {
          if (clients.size === 0) {
            delete roomScenes[roomId];
            console.log(
              `🗑️ Room ${roomId} is now empty and has been cleaned up.`
            );
          } else {
            console.log(`👥 Room ${roomId} still has ${clients.size} user(s)`);
          }
        });
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(
    `🚀 Signaling and Scene server running on http://localhost:${PORT}`
  );
  console.log(`📦 Max buffer size: 100MB`);
  console.log(`⏱️ Ping timeout: 60s, Ping interval: 25s`);
});