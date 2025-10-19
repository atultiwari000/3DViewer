"use client";

import React, { useRef, useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import VideoFeed from "@/components/VideoFeed";
import Scene, { SceneHandle } from "@/components/ThreeScene";
import GestureDebug from "@/components/GestureDebug";
import ProgressBar from "@/components/ProgressBar";
import {
  useWebRTC,
  SceneAction,
  Transform,
  CameraTransform,
  EulerOrder,
} from "@/hooks/useWebRTC";
import GestureRecognition, {
  TwoHandGestureData,
  Axis,
  Action,
} from "@/components/GestureRecognition";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";

const SENSITIVITY = { move: 6, scale: 6, rotate: Math.PI, pan: 6 };
const DEADZONE = 0.05;
const SMOOTHING = 0.5;

interface GestureState {
  action: Action;
  axis: Axis;
  startCentroid: { x: number; y: number };
  lastOffset: { x: number; y: number };
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;

  const sceneRef = useRef<SceneHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transformRef = useRef<Transform | null>(null);
  const cameraRef = useRef<CameraTransform | null>(null);
  const gestureStateRef = useRef<GestureState | null>(null);

  //track if we're applying our own updates
  const isLocalUpdateRef = useRef(false);

  const [gestureData, setGestureData] = useState<TwoHandGestureData | null>(
    null
  );

  // update refs for local and remote actions
  const handleSceneAction = useCallback((action: SceneAction) => {
    const { current: scene } = sceneRef;
    if (!scene) return;

    // skip if this is our own local update being echoed back
    if (isLocalUpdateRef.current) {
      return;
    }

    switch (action.type) {
      case "loadModel":
        scene.loadModel(action.payload, (initialTransform) => {
          transformRef.current = initialTransform;
        });
        break;
      case "transform":
        scene.applyTransform(action.payload);
        transformRef.current = action.payload;
        break;
      case "camera":
        scene.applyCameraTransform(action.payload);
        cameraRef.current = action.payload;
        break;
      case "clear":
        scene.clear();
        transformRef.current = null;
        cameraRef.current = null;
        break;
    }
  }, []);

  const {
    localStream,
    remoteStreams,
    sendSceneAction,
    disconnect,
    uploadProgress,
    downloadProgress,
  } = useWebRTC({ roomId, onSceneAction: handleSceneAction });

  // update local refs when transform changes
  const onTransformChange = useCallback(
    (transform: Transform) => {
      // don't send updates during gesture-based transforms
      if (gestureStateRef.current) {
        return;
      }

      transformRef.current = transform;
      sendSceneAction({ type: "transform", payload: transform });
    },
    [sendSceneAction]
  );

  // update local refs when camera changes
  const onCameraChange = useCallback(
    (camera: CameraTransform) => {
      // don't send updates during gesture-based camera control
      if (gestureStateRef.current?.action === "victory") {
        return;
      }

      cameraRef.current = camera;
      sendSceneAction({ type: "camera", payload: camera });
    },
    [sendSceneAction]
  );

  // helper function to apply and broadcast updates
  const applyAndBroadcastTransform = useCallback(
    (newTransform: Transform) => {
      // nark as local update
      isLocalUpdateRef.current = true;

      // update local ref FIRST
      transformRef.current = newTransform;

      // apply to scene
      sceneRef.current?.applyTransform(newTransform);

      sendSceneAction({ type: "transform", payload: newTransform });

      // to reset flag after a short delay
      setTimeout(() => {
        isLocalUpdateRef.current = false;
      }, 50);
    },
    [sendSceneAction]
  );

  const applyAndBroadcastCamera = useCallback(
    (newCamera: CameraTransform) => {
      // mark as local update
      isLocalUpdateRef.current = true;

      // update local ref FIRST
      cameraRef.current = newCamera;

      sceneRef.current?.applyCameraTransform(newCamera);

      sendSceneAction({ type: "camera", payload: newCamera });

      setTimeout(() => {
        isLocalUpdateRef.current = false;
      }, 50);
    },
    [sendSceneAction]
  );

  const handleGesture = useCallback(
    (data: TwoHandGestureData) => {
      setGestureData(data);
      const axisHand = data.left;
      const actionHand = data.right;

      const getCentroid = (landmarks: NormalizedLandmark[]) =>
        landmarks.reduce(
          (acc, lm) => ({
            x: acc.x + lm.x / landmarks.length,
            y: acc.y + lm.y / landmarks.length,
          }),
          { x: 0, y: 0 }
        );

      // GESTURE END
      if (!actionHand?.action) {
        gestureStateRef.current = null;
        return;
      }

      const { action } = actionHand;
      const axis = axisHand?.axis || "x";

      // GESTURE START
      if (
        gestureStateRef.current?.action !== action ||
        gestureStateRef.current?.axis !== axis
      ) {
        gestureStateRef.current = {
          action,
          axis,
          startCentroid: getCentroid(actionHand.landmarks),
          lastOffset: { x: 0, y: 0 },
        };
        return;
      }

      // GESTURE CONTINUES
      const state = gestureStateRef.current;
      const currentTransform = transformRef.current;
      const currentCamera = cameraRef.current;

      // check if we have the data we need
      if (!currentTransform) {
        console.warn("No transform available for gesture");
        return;
      }

      if (!currentCamera && action === "victory") {
        console.warn("No camera available for pan gesture");
        return;
      }

      const currentCentroid = getCentroid(actionHand.landmarks);

      let offset = {
        x: currentCentroid.x - state.startCentroid.x,
        y: -(currentCentroid.y - state.startCentroid.y),
      };

      // smooth the joystick movement
      offset.x = SMOOTHING * offset.x + (1 - SMOOTHING) * state.lastOffset.x;
      offset.y = SMOOTHING * offset.y + (1 - SMOOTHING) * state.lastOffset.y;
      state.lastOffset = offset;

      // Deadzone check
      if (Math.hypot(offset.x, offset.y) < DEADZONE) {
        return;
      }

      //use the helper functions that update refs
      switch (action) {
        case "fist": {
          // Continuous Move
          const newPos = [...currentTransform.position] as [
            number,
            number,
            number
          ];
          if (axis === "x") newPos[0] += offset.x * SENSITIVITY.move;
          else if (axis === "y") newPos[1] += offset.y * SENSITIVITY.move;
          else if (axis === "z") newPos[2] += offset.y * SENSITIVITY.move;

          applyAndBroadcastTransform({
            ...currentTransform,
            position: newPos,
          });
          break;
        }
        case "pinch": {
          // Continuous Scale
          const scaleVelocity = 1 + offset.y * SENSITIVITY.scale * 0.01;
          const newScale = [...currentTransform.scale] as [
            number,
            number,
            number
          ];

          if (axis === "x")
            newScale[0] = Math.max(
              0.1,
              Math.min(10, newScale[0] * scaleVelocity)
            );
          else if (axis === "y")
            newScale[1] = Math.max(
              0.1,
              Math.min(10, newScale[1] * scaleVelocity)
            );
          else if (axis === "z")
            newScale[2] = Math.max(
              0.1,
              Math.min(10, newScale[2] * scaleVelocity)
            );

          applyAndBroadcastTransform({
            ...currentTransform,
            scale: newScale,
          });
          break;
        }
        case "point": {
          // continuous Rotate
          const rotVelocity = offset.x * SENSITIVITY.rotate;
          const newRot = [...currentTransform.rotation] as [
            number,
            number,
            number,
            EulerOrder
          ];

          if (axis === "x") newRot[0] += rotVelocity;
          else if (axis === "y") newRot[1] += rotVelocity;
          else if (axis === "z") newRot[2] += rotVelocity;

          applyAndBroadcastTransform({
            ...currentTransform,
            rotation: newRot,
          });
          break;
        }
        case "victory": {
          // Continuous Pan
          if (!currentCamera) return;

          const newCamPos = [...currentCamera.position] as [
            number,
            number,
            number
          ];
          const newCamTgt = [...currentCamera.target] as [
            number,
            number,
            number
          ];

          if (axis === "x") {
            newCamPos[0] -= offset.x * SENSITIVITY.pan;
            newCamTgt[0] -= offset.x * SENSITIVITY.pan;
          } else {
            newCamPos[1] -= offset.y * SENSITIVITY.pan;
            newCamTgt[1] -= offset.y * SENSITIVITY.pan;
          }

          applyAndBroadcastCamera({
            position: newCamPos,
            target: newCamTgt,
          });
          break;
        }
      }
    },
    [applyAndBroadcastTransform, applyAndBroadcastCamera]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        sendSceneAction({ type: "loadModel", payload: dataUrl }, file.name);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [sendSceneAction]
  );

  const handleClearScene = useCallback(() => {
    transformRef.current = null;
    cameraRef.current = null;
    sendSceneAction({ type: "clear" });
  }, [sendSceneAction]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    router.push("/");
  }, [disconnect, router]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gray-900">
      <Scene
        ref={sceneRef}
        onTransformChange={onTransformChange}
        onCameraChange={onCameraChange}
      />

      <ProgressBar
        uploading={uploadProgress.uploading}
        progress={uploadProgress.progress}
        fileName={uploadProgress.fileName}
        type="upload"
      />
      <ProgressBar
        uploading={downloadProgress.uploading}
        progress={downloadProgress.progress}
        fileName={downloadProgress.fileName}
        type="download"
      />

      <div className="absolute inset-0 pointer-events-none z-20">
        {localStream && (
          <div className="absolute top-4 right-4 pointer-events-auto">
            <VideoFeed stream={localStream} isMuted={true} label="You" />
            <GestureRecognition
              stream={localStream}
              onGesture={handleGesture}
            />
          </div>
        )}
        {Object.entries(remoteStreams).map(([userId, stream]) => (
          <div
            key={userId}
            className="absolute pointer-events-auto"
            style={{
              bottom: 20 + Object.keys(remoteStreams).indexOf(userId) * 170,
              left: 20,
            }}
          >
            <VideoFeed
              stream={stream}
              isMuted={false}
              label={`User ${Object.keys(remoteStreams).indexOf(userId) + 1}`}
            />
          </div>
        ))}
      </div>

      <GestureDebug gestureData={gestureData} />

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
          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg transition-colors"
        >
          Upload Model
        </button>
        <button
          onClick={handleClearScene}
          className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg transition-colors"
        >
          Clear Scene
        </button>
        <button
          onClick={handleDisconnect}
          className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg shadow-lg transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
