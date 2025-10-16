"use client";

import React, { useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import VideoFeed from "@/components/VideoFeed";
import Scene, { SceneHandle } from "@/components/ThreeScene";
import { useWebRTC } from "@/hooks/useWebRTC";
import GestureRecognition, {
  GestureData,
} from "@/components/GestureRecognition";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";

// --- TYPES & INTERFACES ---
interface Transform {
  position: [number, number, number];
  rotation: [number, number, number, string];
  scale: [number, number, number];
}

interface CameraTransform {
  position: [number, number, number];
  target: [number, number, number];
}

interface GestureState {
  gesture: string;
  startLandmarks: NormalizedLandmark[];
  initialTransform: Transform | null;
  initialCamera: CameraTransform | null;
}

// --- COMPONENT ---
export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  // --- REFS ---
  const sceneRef = useRef<SceneHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transformRef = useRef<Transform | null>(null);
  const cameraRef = useRef<CameraTransform | null>(null);
  const gestureStateRef = useRef<GestureState | null>(null);

  // --- CALLBACKS & HANDLERS ---
  const handleSceneAction = useCallback((action: any) => {
    if (!sceneRef.current) return;

    switch (action.type) {
      case "loadModel":
        sceneRef.current.loadModel(action.payload, (initialTransform) => {
          transformRef.current = initialTransform;
        });
        break;
      case "transform":
        transformRef.current = action.payload;
        sceneRef.current.applyTransform(action.payload);
        break;
      case "camera":
        // Store camera state locally for gesture calculations
        cameraRef.current = action.payload;
        sceneRef.current.applyCameraTransform?.(action.payload);
        break;
      case "clear":
        sceneRef.current.clear();
        transformRef.current = null;
        break;
    }
  }, []);

  const {
    localStream,
    remoteStreams,
    isConnected,
    uploadProgress,
    downloadProgress,
    sendSceneAction,
    disconnect,
  } = useWebRTC({
    roomId,
    onSceneAction: handleSceneAction,
  });

  const handleTransformChange = useCallback(
    (transform: Transform) => {
      sendSceneAction({ type: "transform", payload: transform });
    },
    [sendSceneAction]
  );

  const handleCameraChange = useCallback(
    (camera: CameraTransform) => {
      // Also update our local ref when the camera is moved manually
      cameraRef.current = camera;
      sendSceneAction({ type: "camera", payload: camera });
    },
    [sendSceneAction]
  );

  // --- NEW GESTURE HANDLING LOGIC ---
  const handleGesture = useCallback(
    (data: GestureData) => {
      const { gesture, landmarks } = data;

      // Check if a new gesture has started
      if (
        !gestureStateRef.current ||
        gestureStateRef.current.gesture !== gesture
      ) {
        console.log(`✨ New gesture started: ${gesture}`);
        gestureStateRef.current = {
          gesture,
          startLandmarks: landmarks,
          initialTransform: transformRef.current
            ? JSON.parse(JSON.stringify(transformRef.current))
            : null,
          initialCamera: cameraRef.current
            ? JSON.parse(JSON.stringify(cameraRef.current))
            : null,
        };
        return; // Wait for the next frame to calculate delta
      }

      const { startLandmarks, initialTransform, initialCamera } =
        gestureStateRef.current;
      const startCentroid = getCentroid(startLandmarks);
      const currentCentroid = getCentroid(landmarks);

      const delta = {
        x: (currentCentroid.x - startCentroid.x) * 2, // Multiplier for sensitivity
        y: (currentCentroid.y - startCentroid.y) * -2, // Invert Y-axis for intuitive control
      };

      switch (gesture) {
        case "fist": // Move Model (Translate)
          if (initialTransform) {
            const newTransform = { ...initialTransform };
            newTransform.position[0] += delta.x;
            newTransform.position[1] += delta.y;
            sendSceneAction({ type: "transform", payload: newTransform });
          }
          break;

        case "pinch": // Scale Model
          if (initialTransform) {
            const newTransform = { ...initialTransform };
            const scaleFactor = 1 + delta.y * 0.1; // Scale based on vertical movement
            newTransform.scale = initialTransform.scale.map(
              (s) => s * scaleFactor
            ) as [number, number, number];
            sendSceneAction({ type: "transform", payload: newTransform });
          }
          break;

        case "point": // Rotate Model
          if (initialTransform) {
            const newTransform = { ...initialTransform };
            newTransform.rotation[1] += delta.x * 0.05; // Yaw
            newTransform.rotation[0] += delta.y * 0.05; // Pitch
            sendSceneAction({ type: "transform", payload: newTransform });
          }
          break;

        case "victory": // Pan Camera
          if (initialCamera) {
            const newCamera = { ...initialCamera };
            // Adjust camera position and target to simulate panning
            newCamera.position[0] -= delta.x * 0.1;
            newCamera.target[0] -= delta.x * 0.1;
            newCamera.position[1] -= delta.y * 0.1;
            newCamera.target[1] -= delta.y * 0.1;
            sendSceneAction({ type: "camera", payload: newCamera });
          }
          break;
      }
    },
    [sendSceneAction]
  );

  const getCentroid = (landmarks: NormalizedLandmark[]) => {
    return landmarks.reduce(
      (acc, lm) => ({ x: acc.x + lm.x, y: acc.y + lm.y }),
      { x: 0, y: 0 }
    );
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = e.target?.result as string;
      await sendSceneAction({ type: "loadModel", payload: result }, file.name);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleClearScene = () => sendSceneAction({ type: "clear" });
  const handleDisconnect = () => {
    disconnect();
    router.push("/");
  };

  // --- RENDER ---
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gray-900">
      <div className="absolute inset-0 z-0">
        <Scene
          ref={sceneRef}
          onTransformChange={handleTransformChange}
          onCameraChange={handleCameraChange}
        />
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <div
          className={`px-4 py-2 rounded-full text-white text-sm font-semibold transition-colors ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        >
          {isConnected ? "● Connected" : "● Disconnected"}
        </div>
      </div>

      {/* Progress Indicators */}
      {(uploadProgress.uploading || downloadProgress.uploading) && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 bg-white rounded-lg shadow-lg p-4 min-w-[300px]">
          <div className="text-sm font-semibold mb-2">
            {uploadProgress.uploading
              ? `Uploading: ${uploadProgress.fileName}`
              : `Receiving: ${downloadProgress.fileName}`}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${
                uploadProgress.uploading ? "bg-blue-600" : "bg-green-600"
              }`}
              style={{
                width: `${
                  uploadProgress.uploading
                    ? uploadProgress.progress
                    : downloadProgress.progress
                }%`,
              }}
            ></div>
          </div>
        </div>
      )}

      {/* Video Feeds & Gesture Recognition */}
      <div className="absolute inset-0 pointer-events-none z-20">
        <div className="relative w-full h-full">
          {localStream && (
            <div className="absolute top-4 right-4 pointer-events-auto">
              <VideoFeed stream={localStream} isMuted={true} label="You" />
              <GestureRecognition
                stream={localStream}
                onGesture={handleGesture}
              />
            </div>
          )}
          {Object.entries(remoteStreams)
            .filter(([_, stream]) => stream && stream.active)
            .map(([userId, stream], index) => (
              <div
                key={userId}
                className="absolute pointer-events-auto"
                style={{ bottom: 20 + index * 170, left: 20 }}
              >
                <VideoFeed
                  stream={stream}
                  isMuted={false}
                  label={`User ${index + 1}`}
                />
              </div>
            ))}
        </div>
      </div>

      {/* UI Controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-30">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept=".gltf,.glb,.obj,.fbx"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadProgress.uploading}
          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg"
        >
          Upload Model
        </button>
        <button
          onClick={handleClearScene}
          className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg"
        >
          Clear Scene
        </button>
        <button
          onClick={handleDisconnect}
          className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg"
        >
          Disconnect
        </button>
      </div>

      {/* Room Info */}
      <div className="absolute bottom-4 right-4 bg-black bg-opacity-50 text-white px-4 py-2 rounded-lg text-sm z-30">
        Room: <span className="font-mono font-bold">{roomId}</span>
      </div>
    </div>
  );
}
