"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import io, { Socket } from "socket.io-client";

const SIGNALING_SERVER_URL = "http://localhost:3001";

export type EulerOrder = 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';

export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number, EulerOrder];
  scale: [number, number, number];
}

export interface CameraTransform {
  position: [number, number, number];
  target: [number, number, number];
}

export type SceneAction =
  | { type: "loadModel"; payload: string; metadata?: { name: string } }
  | { type: "transform"; payload: Transform }
  | { type: "camera"; payload: CameraTransform }
  | { type: "clear" };

interface UseWebRTCProps {
  roomId: string;
  onSceneAction: (action: SceneAction) => void;
}

interface Progress {
  uploading: boolean;
  progress: number;
  fileName: string;
}

// --- HOOK IMPLEMENTATION ---
export const useWebRTC = ({ roomId, onSceneAction }: UseWebRTCProps) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Progress>({ uploading: false, progress: 0, fileName: "" });
  const [downloadProgress, setDownloadProgress] = useState<Progress>({ uploading: false, progress: 0, fileName: "" });

  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const socket = useRef<Socket | null>(null);
  const onSceneActionRef = useRef(onSceneAction);

  useEffect(() => {
    onSceneActionRef.current = onSceneAction;
  }, [onSceneAction]);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => setLocalStream(stream))
      .catch(error => console.error("❌ Error accessing media devices:", error));

    return () => {
      localStream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!roomId || !localStream) return;

    const s = io(SIGNALING_SERVER_URL, { transports: ["websocket"] });
    socket.current = s;

    const createPeerConnection = (remoteUserId: string) => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  
        pc.onicecandidate = event => {
          if (event.candidate) s.emit("signal", { to: remoteUserId, from: s.id, signal: event.candidate });
        };
  
        pc.ontrack = event => {
          setRemoteStreams(prev => ({ ...prev, [remoteUserId]: event.streams[0] }));
        };
  
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        peerConnections.current[remoteUserId] = pc;
        return pc;
      };

    s.on("connect", () => {
      setIsConnected(true);
      s.emit("join", roomId);
    });

    s.on("scene:init", (sceneState) => {
        if (sceneState.model) {
            setDownloadProgress({ uploading: true, progress: 50, fileName: sceneState.metadata?.name || "model.glb" });
            setTimeout(() => setDownloadProgress(prev => ({ ...prev, progress: 100 })), 500);
            setTimeout(() => setDownloadProgress({ uploading: false, progress: 0, fileName: "" }), 1500);

            onSceneActionRef.current({ type: 'loadModel', payload: sceneState.model, metadata: sceneState.metadata });
        }
        if (sceneState.transform) {
            setTimeout(() => onSceneActionRef.current({ type: 'transform', payload: sceneState.transform }), 100);
        }
        if (sceneState.camera) {
            setTimeout(() => onSceneActionRef.current({ type: 'camera', payload: sceneState.camera }), 150);
        }
    });

    s.on("scene:update", (data: { action: SceneAction; from: string }) => {
      if (data.from === s.id) return;

      if (data.action.type === "loadModel") {
        setDownloadProgress({ uploading: true, progress: 50, fileName: data.action.metadata?.name || "model.glb" });
        setTimeout(() => setDownloadProgress(prev => ({ ...prev, progress: 100 })), 500);
        setTimeout(() => setDownloadProgress({ uploading: false, progress: 0, fileName: "" }), 1500);
      }

      onSceneActionRef.current(data.action);
    });

    s.on("user-connected", async (userId: string) => {
      const pc = createPeerConnection(userId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      s.emit("signal", { to: userId, from: s.id, signal: pc.localDescription });
    });

    s.on("signal", async ({ from, signal }) => {
      const pc = peerConnections.current[from] || createPeerConnection(from);
      if (signal.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        s.emit("signal", { to: from, from: s.id, signal: answer });
      } else if (signal.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal));
      }
    });

    s.on("user-disconnected", (userId: string) => {
      peerConnections.current[userId]?.close();
      delete peerConnections.current[userId];
      setRemoteStreams(prev => { const newState = { ...prev }; delete newState[userId]; return newState; });
    });

    s.on("disconnect", () => setIsConnected(false));

    return () => {
      s.disconnect();
      Object.values(peerConnections.current).forEach(pc => pc.close());
    };
  }, [roomId, localStream]);

  const sendSceneAction = useCallback((action: SceneAction, fileName?: string) => {
    // ARCHITECTURAL FIX: Apply action locally for optimistic UI.
    onSceneActionRef.current(action);

    if (action.type === "loadModel") {
        setUploadProgress({ uploading: true, progress: 50, fileName: fileName || "model.glb" });
        setTimeout(() => setUploadProgress(prev => ({ ...prev, progress: 100 })), 500);
        setTimeout(() => setUploadProgress({ uploading: false, progress: 0, fileName: "" }), 1500);
    }
    
    if (socket.current?.connected) {
      const actionWithMetadata = action.type === "loadModel" 
          ? { ...action, metadata: { name: fileName || "model.glb" } } 
          : action;
      socket.current.emit("scene:action", actionWithMetadata);
    }
  }, []);

  const disconnect = useCallback(() => {
    socket.current?.disconnect();
  }, []);

  return {
    localStream,
    remoteStreams,
    isConnected,
    uploadProgress,
    downloadProgress,
    sendSceneAction,
    disconnect,
  };
};