"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import io, { Socket } from "socket.io-client";

const SIGNALING_SERVER_URL = "http://localhost:3001";

interface UseWebRTCProps {
  roomId: string;
  onSceneAction: (action: any) => void;
}

interface UploadProgress {
  uploading: boolean;
  progress: number;
  fileName: string;
}

export const useWebRTC = ({ roomId, onSceneAction }: UseWebRTCProps) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [isConnected, setIsConnected] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    uploading: false,
    progress: 0,
    fileName: "",
  });
  const [downloadProgress, setDownloadProgress] = useState<UploadProgress>({
    uploading: false,
    progress: 0,
    fileName: "",
  });

  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const socket = useRef<Socket | null>(null);
  const mySocketId = useRef<string | null>(null);
  const onSceneActionRef = useRef(onSceneAction);

  useEffect(() => {
    onSceneActionRef.current = onSceneAction;
  }, [onSceneAction]);

  useEffect(() => {
    const initialize = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        console.log("✅ Local media stream initialized");
      } catch (error) {
        console.error("❌ Error accessing media devices:", error);
      }
    };
    initialize();

    return () => {
      localStream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!roomId || !localStream) {
      return;
    }

    if (socket.current) {
      return;
    }

    socket.current = io(SIGNALING_SERVER_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socket.current.on("connect", () => {
      console.log("✅ Connected to signaling server:", socket.current?.id);
      mySocketId.current = socket.current?.id || null;
      setIsConnected(true);
      socket.current?.emit("join", roomId);
    });

    socket.current.on("disconnect", () => {
      console.log("❌ Disconnected from signaling server");
      setIsConnected(false);
    });

    socket.current.on("connect_error", (error) => {
      console.error("❌ Connection error:", error);
      setIsConnected(false);
    });

    socket.current.on(
      "scene:model-incoming",
      (data: { metadata: any; size: number; from?: string }) => {
        if (data.from && data.from === mySocketId.current) {
          console.log("⏭️ Ignoring own model-incoming notification");
          return;
        }

        console.log("📥 Model incoming:", data.metadata);
        setDownloadProgress({
          uploading: true,
          progress: 0,
          fileName: data.metadata?.name || "model",
        });
      }
    );

    socket.current.on("scene:init", (sceneState: any) => {
      console.log("📦 Received scene:init");
      if (sceneState.model) {
        onSceneActionRef.current({
          type: "loadModel",
          payload: sceneState.model,
        });

        setDownloadProgress({
          uploading: false,
          progress: 100,
          fileName: "",
        });

        socket.current?.emit("scene:init-ack");

        if (sceneState.transform) {
          setTimeout(() => {
            onSceneActionRef.current({
              type: "transform",
              payload: sceneState.transform,
            });
          }, 100);
        }

        if (sceneState.camera) {
          setTimeout(() => {
            onSceneActionRef.current({
              type: "camera",
              payload: sceneState.camera,
            });
          }, 150);
        }
      }
    });

    socket.current.on("scene:update", (data: { action: any; from: string }) => {
      console.log("🔄 Received scene:update:", data.action.type, "from:", data.from);

      // --- CHANGE START ---
      // The guard to ignore a client's own actions is now REMOVED.
      // With the new server-first architecture, the client sends an action (e.g., a transform)
      // to the server and does nothing locally. It MUST wait to receive the update
      // back from the server broadcast to see its own change. This guarantees sync.
      /*
      if (data.from === mySocketId.current) {
        console.log("⏭️ Ignoring own scene:update (from === mySocketId)");
        return;
      }
      */
      // --- CHANGE END ---

      if (data.action.type === "loadModel") {
        console.log("🎨 Loading model from scene:update");
        setDownloadProgress({
          uploading: false,
          progress: 100,
          fileName: "",
        });
      }

      onSceneActionRef.current(data.action);
    });

    socket.current.on(
      "gesture:action",
      (data: { gesture: string; from: string }) => {
        if (data.from === mySocketId.current) {
          return;
        }
        console.log("👋 Received gesture from:", data.from, "gesture:", data.gesture);
      }
    );

    socket.current.on("user-connected", async (userId: string) => {
      console.log("🔗 User connected:", userId);
      try {
        const pc = createPeerConnection(userId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.current?.emit("signal", {
          to: userId,
          from: socket.current?.id,
          signal: pc.localDescription,
        });
      } catch (error) {
        console.error("❌ Error creating offer:", error);
      }
    });

    socket.current.on(
      "signal",
      async ({ from, signal }: { from: string; signal: any }) => {
        let pc = peerConnections.current[from];
        if (!pc) {
          pc = createPeerConnection(from);
        }

        try {
          if (signal.type === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.current?.emit("signal", {
              to: from,
              from: socket.current?.id,
              signal: answer,
            });
          } else if (signal.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
          } else if (signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal));
          }
        } catch (error) {
          console.error("❌ Error handling signal:", error);
        }
      }
    );

    socket.current.on("user-disconnected", (userId: string) => {
      console.log("👋 User disconnected:", userId);
      peerConnections.current[userId]?.close();
      delete peerConnections.current[userId];
      setRemoteStreams((prevStreams) => {
        const newStreams = { ...prevStreams };
        delete newStreams[userId];
        return newStreams;
      });
    });

    return () => {
      socket.current?.disconnect();
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
      socket.current = null;
    };
  }, [roomId, localStream]);

  const createPeerConnection = (remoteUserId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current?.emit("signal", {
          to: remoteUserId,
          from: socket.current?.id,
          signal: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams((prevStreams) => ({
        ...prevStreams,
        [remoteUserId]: event.streams[0],
      }));
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    peerConnections.current[remoteUserId] = pc;
    return pc;
  };

  const sendSceneAction = (action: any, fileName?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socket.current?.connected) {
        resolve(false);
        return;
      }

      if (action.type === "loadModel") {
        setUploadProgress({
          uploading: true,
          progress: 50, // Start progress
          fileName: fileName || "model",
        });
      }

      const actionWithMetadata =
        action.type === "loadModel"
          ? { ...action, metadata: { name: fileName || "model" } }
          : action;

      socket.current?.emit(
        "scene:action",
        actionWithMetadata,
        (response: any) => {
          if (response?.success) {
            if (action.type === "loadModel") {
              // Update progress to 100 and then hide
              setUploadProgress((prev) => ({ ...prev, progress: 100 }));
              setTimeout(() => {
                setUploadProgress({ uploading: false, progress: 0, fileName: "" });
              }, 500);
            }
            resolve(true);
          } else {
            if (action.type === "loadModel") {
              setUploadProgress({ uploading: false, progress: 0, fileName: "" });
            }
            resolve(false);
          }
        }
      );
    });
  };

  const sendGesture = (gesture: string) => {
    if (socket.current?.connected) {
      socket.current.emit("gesture:action", { gesture });
    }
  };

  const disconnect = () => {
    socket.current?.disconnect();
  };

  return {
    localStream,
    remoteStreams,
    isConnected,
    uploadProgress,
    downloadProgress,
    sendSceneAction,
    sendGesture,
    disconnect,
  };
};
