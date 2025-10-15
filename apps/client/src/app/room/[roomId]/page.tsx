"use client";

import { useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import VideoFeed from "@/components/VideoFeed";
import Scene, { SceneHandle } from "@/components/ThreeScene";
import { useWebRTC } from "@/hooks/useWebRTC";
import GestureRecognition from "@/components/GestureRecognition"; // Import GestureRecognition

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const sceneRef = useRef<SceneHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [isUploadingLocal, setIsUploadingLocal] = useState(false);
  const lastModelDataRef = useRef<string | null>(null);
  const isUploaderRef = useRef<boolean>(false); // Track if we uploaded the current model
  const pinchStart = useRef<{ x: number; y: number } | null>(null);
  const initialScale = useRef(1);

  const handleSceneAction = useCallback(
    (action: any) => {
      if (!sceneRef.current) {
        console.warn("⚠️ Scene ref not available");
        return;
      }

      console.log("📥 handleSceneAction called:", {
        type: action.type,
        isUploader: isUploaderRef.current,
      });

      switch (action.type) {
        case "loadModel":
          // CRITICAL: If we're the uploader, we already have the model loaded locally
          // Don't reload it from the remote action
          if (isUploaderRef.current) {
            console.log(
              "⏭️ Skipping loadModel - we are the uploader (model already loaded locally)"
            );
            return;
          }

          console.log("🎨 Loading model from remote action");
          lastModelDataRef.current = action.payload;
          sceneRef.current.loadModel(action.payload);
          break;
        case "transform":
          // Prevent feedback loop
          if (!isTransforming) {
            console.log("🔄 Applying remote transform");
            sceneRef.current.applyTransform(action.payload);
          } else {
            console.log("⏭️ Skipping transform (feedback prevention)");
          }
          break;
        case "clear":
          console.log("🧹 Clearing scene from remote action");
          lastModelDataRef.current = null;
          isUploaderRef.current = false;
          sceneRef.current.clear();
          break;
      }
    },
    [isTransforming]
  );

  const {
    localStream,
    remoteStreams,
    isConnected,
    uploadProgress,
    downloadProgress,
    sendSceneAction,
    sendGesture,
    disconnect,
  } = useWebRTC({
    roomId,
    onSceneAction: handleSceneAction,
  });

  const handleTransformChange = useCallback(
    (transform: any) => {
      setIsTransforming(true);
      sendSceneAction({ type: "transform", payload: transform });
      // Reset flag after a short delay
      setTimeout(() => setIsTransforming(false), 50);
    },
    [sendSceneAction]
  );

  const handleGesture = useCallback(
    (gesture: string) => {
      console.log("👋 Gesture detected:", gesture);

      if (!sceneRef.current) {
        console.warn("⚠️ Scene ref not available for gesture");
        return;
      }

      // Handle gestures locally
      switch (gesture) {
        case "pinch":
          // Scale model down
          console.log("🤏 Pinch gesture - scaling down");
          const currentTransform = sceneRef.current.getTransform?.();
          if (currentTransform) {
            const newScale = currentTransform.scale.map((s: number) => s * 0.9);
            sendSceneAction({
              type: "transform",
              payload: { ...currentTransform, scale: newScale },
            });
          }
          break;

        case "open_hand":
          // Scale model up
          console.log("✋ Open hand gesture - scaling up");
          const transform = sceneRef.current.getTransform?.();
          if (transform) {
            const newScale = transform.scale.map((s: number) => s * 1.1);
            sendSceneAction({
              type: "transform",
              payload: { ...transform, scale: newScale },
            });
          }
          break;

        case "swipe_left":
          // Rotate left
          console.log("👈 Swipe left - rotating");
          const leftTransform = sceneRef.current.getTransform?.();
          if (leftTransform) {
            const newRotation = [...leftTransform.rotation];
            newRotation[1] -= 0.2; // Rotate around Y axis
            sendSceneAction({
              type: "transform",
              payload: { ...leftTransform, rotation: newRotation },
            });
          }
          break;

        case "swipe_right":
          // Rotate right
          console.log("👉 Swipe right - rotating");
          const rightTransform = sceneRef.current.getTransform?.();
          if (rightTransform) {
            const newRotation = [...rightTransform.rotation];
            newRotation[1] += 0.2; // Rotate around Y axis
            sendSceneAction({
              type: "transform",
              payload: { ...rightTransform, rotation: newRotation },
            });
          }
          break;

        default:
          console.log("Unknown gesture:", gesture);
      }

      // Broadcast gesture to other users (for UI feedback)
      sendGesture(gesture);
    },
    [sceneRef, sendSceneAction, sendGesture]
  );

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Prevent multiple simultaneous uploads
    if (isUploadingLocal || uploadProgress.uploading) {
      console.log("⏳ Upload already in progress");
      return;
    }

    console.log(
      "📁 File selected:",
      file.name,
      "Size:",
      (file.size / 1024 / 1024).toFixed(2),
      "MB"
    );

    // Check file size (warn if > 50MB)
    if (file.size > 50 * 1024 * 1024) {
      const confirmed = window.confirm(
        `This file is ${(file.size / 1024 / 1024).toFixed(
          2
        )}MB. Large files may take time to upload. Continue?`
      );
      if (!confirmed) return;
    }

    setIsUploadingLocal(true);

    const reader = new FileReader();

    reader.onload = async (e) => {
      const result = e.target?.result as string;

      console.log("📖 File read complete, size:", result.length, "bytes");

      try {
        // Mark that we are the uploader of this model
        isUploaderRef.current = true;

        // Store the model data
        lastModelDataRef.current = result;

        // Load locally FIRST for instant feedback
        console.log("🎨 Loading model locally (uploader's view)");
        if (sceneRef.current) {
          sceneRef.current.loadModel(result);
        }

        // Wait for local load to complete
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Then broadcast to other users
        console.log("📤 Broadcasting model to remote users");
        const success = await sendSceneAction(
          { type: "loadModel", payload: result },
          file.name
        );

        if (success) {
          console.log("✅ Model broadcast successful - staying as uploader");
        } else {
          console.error("❌ Model broadcast failed");
          alert(
            "Failed to upload model to other users. Your local view is unaffected."
          );
        }
      } catch (error) {
        console.error("❌ Error during model upload:", error);
        alert("Failed to load model. Please try again.");
        lastModelDataRef.current = null;
        isUploaderRef.current = false;
      } finally {
        setIsUploadingLocal(false);
      }
    };

    reader.onerror = (error) => {
      console.error("❌ Error reading file:", error);
      alert("Failed to read file. Please try again.");
      setIsUploadingLocal(false);
      isUploaderRef.current = false;
    };

    reader.readAsDataURL(file);

    // Reset file input so the same file can be selected again
    event.target.value = "";
  };

  const handleClearScene = async () => {
    console.log("🧹 Clearing scene (initiated locally)");
    lastModelDataRef.current = null;
    isUploaderRef.current = false;
    sceneRef.current?.clear();
    await sendSceneAction({ type: "clear" });
  };

  const handleDisconnect = () => {
    console.log("👋 Disconnecting from room");
    disconnect();
    router.push("/");
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gray-900">
      {/* 3D Scene - Base layer z-0 */}
      <div className="absolute inset-0 z-0">
        <Scene ref={sceneRef} onTransformChange={handleTransformChange} />
      </div>

      {/* Connection Status */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
        <div
          className={`px-4 py-2 rounded-full text-white text-sm font-semibold transition-colors ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        >
          {isConnected ? "● Connected" : "● Disconnected"}
        </div>
      </div>

      {/* Upload Progress */}
      {(uploadProgress.uploading || isUploadingLocal) && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10 bg-white rounded-lg shadow-lg p-4 min-w-[300px]">
          <div className="text-sm font-semibold mb-2">
            {isUploadingLocal
              ? "Loading locally..."
              : `Uploading: ${uploadProgress.fileName}`}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
              style={{
                width: `${isUploadingLocal ? 100 : uploadProgress.progress}%`,
              }}
            ></div>
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {isUploadingLocal ? "Preparing..." : `${uploadProgress.progress}%`}
          </div>
        </div>
      )}

      {/* Download Progress */}
      {downloadProgress.uploading && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-10 bg-white rounded-lg shadow-lg p-4 min-w-[300px]">
          <div className="text-sm font-semibold mb-2">
            Receiving: {downloadProgress.fileName}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-green-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress.progress}%` }}
            ></div>
          </div>
          <div className="text-xs text-gray-600 mt-1">Please wait...</div>
        </div>
      )}

      {/* Video Feeds - Only render when streams are available */}
      <div className="absolute inset-0 pointer-events-none z-20">
        <div className="relative w-full h-full">
          {/* Local Video Feed - Top Right */}
          {localStream && (
            <div className="absolute top-4 right-4 pointer-events-auto">
              <VideoFeed stream={localStream} isMuted={true} label="You" />
              <GestureRecognition onGesture={handleGesture} />
            </div>
          )}

          {/* Remote Video Feeds - Bottom Left Area */}
          {Object.entries(remoteStreams)
            .filter(([_, stream]) => stream && stream.active)
            .map(([userId, stream], index) => (
              <div
                key={userId}
                className="absolute pointer-events-auto"
                style={{
                  bottom: 20 + index * 170,
                  left: 20,
                }}
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

      {/* Control Panel - z-30 to be above everything */}
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
          disabled={uploadProgress.uploading || isUploadingLocal}
          className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          {uploadProgress.uploading || isUploadingLocal
            ? "Uploading..."
            : "Upload Model"}
        </button>
        <button
          onClick={handleClearScene}
          className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          Clear Scene
        </button>
        <button
          onClick={handleDisconnect}
          className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Disconnect
        </button>
      </div>

      {/* Room Info - z-30 */}
      <div className="absolute bottom-4 right-4 bg-black bg-opacity-50 text-white px-4 py-2 rounded-lg text-sm z-30">
        Room: <span className="font-mono font-bold">{roomId}</span>
        <div className="text-xs mt-1 opacity-75">
          {Object.keys(remoteStreams).length + (localStream ? 1 : 0)} user(s)
          connected
        </div>
      </div>

      {/* Instructions - z-30 */}
      <div className="absolute bottom-20 right-4 bg-black bg-opacity-70 text-white px-4 py-3 rounded-lg text-xs z-30 max-w-xs">
        <div className="font-semibold mb-1">Transform Controls:</div>
        <div>• Click model to select</div>
        <div>• W = Move | E = Rotate | R = Scale</div>
      </div>
    </div>
  );
}
