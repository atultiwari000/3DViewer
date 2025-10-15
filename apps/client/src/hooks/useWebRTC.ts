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
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
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

  // Keep ref in sync without causing re-renders
  useEffect(() => {
    onSceneActionRef.current = onSceneAction;
  }, [onSceneAction]);

  // Initialize local media stream
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

  // Setup WebRTC and Socket.io - only when roomId and localStream are ready
  useEffect(() => {
    if (!roomId || !localStream) {
      console.log("⏳ Waiting for roomId and localStream...", { roomId, hasStream: !!localStream });
      return;
    }

    if (socket.current) {
      console.log("⏳ Socket already initialized");
      return;
    }

    console.log("🚀 Initializing socket connection for room:", roomId);

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

    // Handle incoming model notification
    socket.current.on("scene:model-incoming", (data: { metadata: any; size: number }) => {
      console.log("📥 Model incoming:", data.metadata);
      setDownloadProgress({
        uploading: true,
        progress: 0,
        fileName: data.metadata?.name || "model",
      });
    });

    // Scene synchronization
    socket.current.on("scene:init", (sceneState: any) => {
      console.log("📦 Received scene:init", {
        hasModel: !!sceneState.model,
        modelSize: sceneState.model?.length,
        hasTransform: !!sceneState.transform,
      });

      if (sceneState.model) {
        console.log("🎨 Loading model from scene:init");
        onSceneActionRef.current({ type: "loadModel", payload: sceneState.model });
        
        setDownloadProgress({
          uploading: false,
          progress: 100,
          fileName: "",
        });

        // Acknowledge receipt
        socket.current?.emit("scene:init-ack");

        // Apply transform after model loads
        if (sceneState.transform) {
          setTimeout(() => {
            onSceneActionRef.current({ type: "transform", payload: sceneState.transform });
          }, 100);
        }
      }
    });

    socket.current.on("scene:update", (data: { action: any; from: string }) => {
      console.log("🔄 Received scene:update:", data.action.type, "from:", data.from);
      
      // IMPORTANT: Don't process our own actions
      if (data.from === mySocketId.current) {
        console.log("⏭️ Ignoring own action");
        return;
      }
      
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

    // Handle gesture actions from remote users
    socket.current.on("gesture:action", (data: { gesture: string; from: string }) => {
      console.log("👋 Received gesture from:", data.from, "gesture:", data.gesture);
      // You can add UI feedback here if needed
    });

    // WebRTC signaling
    socket.current.on("user-connected", async (userId: string) => {
      console.log("🔗 User connected:", userId);
      console.log("Creating peer connection and offer...");
      
      try {
        const pc = createPeerConnection(userId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        console.log("✅ Offer created, sending to:", userId);
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
        console.log("📡 Received signal from:", from, signal.type || "candidate");
        
        let pc = peerConnections.current[from];
        if (!pc) {
          console.log("🔧 Creating new peer connection for:", from);
          pc = createPeerConnection(from);
        }

        try {
          if (signal.type === "offer") {
            console.log("📥 Processing offer from:", from);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log("📤 Sending answer to:", from);
            socket.current?.emit("signal", {
              to: from,
              from: socket.current?.id,
              signal: answer,
            });
          } else if (signal.type === "answer") {
            console.log("📥 Processing answer from:", from);
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
          } else if (signal.candidate) {
            console.log("🧊 Adding ICE candidate from:", from);
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
      console.log("🧹 Cleaning up socket connection");
      socket.current?.disconnect();
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
      socket.current = null;
    };
  }, [roomId, localStream]); // REMOVED onSceneAction from deps

  const createPeerConnection = (remoteUserId: string) => {
    console.log("🔧 Creating peer connection for:", remoteUserId);
    
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("🧊 Sending ICE candidate to:", remoteUserId);
        socket.current?.emit("signal", {
          to: remoteUserId,
          from: socket.current?.id,
          signal: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("🎥 Received track from:", remoteUserId);
      setRemoteStreams((prevStreams) => ({
        ...prevStreams,
        [remoteUserId]: event.streams[0],
      }));
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`🔌 ICE connection state with ${remoteUserId}:`, pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log(`📶 Connection state with ${remoteUserId}:`, pc.connectionState);
      if (pc.connectionState === "connected") {
        console.log("✅ Successfully connected to:", remoteUserId);
      } else if (pc.connectionState === "failed") {
        console.error("❌ Connection failed with:", remoteUserId);
      }
    };

    // Add local tracks
    if (localStream) {
      console.log("➕ Adding local tracks to peer connection");
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
        console.log("  - Added track:", track.kind);
      });
    } else {
      console.warn("⚠️ No local stream available to add tracks");
    }

    peerConnections.current[remoteUserId] = pc;
    return pc;
  };

  const sendSceneAction = (action: any, fileName?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socket.current?.connected) {
        console.error("❌ Socket not connected");
        resolve(false);
        return;
      }

      console.log("📤 Sending scene action:", action.type);

      // Show upload progress for model uploads
      if (action.type === "loadModel") {
        setUploadProgress({
          uploading: true,
          progress: 50,
          fileName: fileName || "model",
        });
      }

      // Add metadata for model uploads
      const actionWithMetadata = action.type === "loadModel" 
        ? {
            ...action,
            metadata: {
              name: fileName || "model",
              size: action.payload?.length || 0,
              type: action.payload?.substring(0, 50) || "unknown",
            },
          }
        : action;

      // Send with acknowledgment
      socket.current?.emit("scene:action", actionWithMetadata, (response: any) => {
        if (response?.success) {
          console.log("✅ Scene action acknowledged:", action.type);
          if (action.type === "loadModel") {
            setUploadProgress({
              uploading: false,
              progress: 100,
              fileName: "",
            });
          }
          resolve(true);
        } else {
          console.error("❌ Scene action failed:", response?.error);
          if (action.type === "loadModel") {
            setUploadProgress({
              uploading: false,
              progress: 0,
              fileName: "",
            });
          }
          resolve(false);
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (action.type === "loadModel" && uploadProgress.uploading) {
          console.error("⏱️ Upload timeout");
          setUploadProgress({
            uploading: false,
            progress: 0,
            fileName: "",
          });
          resolve(false);
        }
      }, 30000);
    });
  };

  const sendGesture = (gesture: string) => {
    if (!socket.current?.connected) {
      console.error("❌ Socket not connected");
      return;
    }
    console.log("👋 Sending gesture:", gesture);
    socket.current.emit("gesture:action", { gesture });
  };

  const disconnect = () => {
    console.log("🔌 Disconnecting...");
    socket.current?.disconnect();
    localStream?.getTracks().forEach((track) => track.stop());
    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};
    setRemoteStreams({});
    setIsConnected(false);
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