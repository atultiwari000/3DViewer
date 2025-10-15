import React, { useEffect, useRef, useState } from "react";
import {
  GestureRecognizer,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

interface GestureRecognitionProps {
  onGesture: (gesture: any) => void;
}

const GestureRecognition: React.FC<GestureRecognitionProps> = ({
  onGesture,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gestureRecognizer, setGestureRecognizer] =
    useState<GestureRecognizer | null>(null);
  const isPinching = useRef(false);
  const isOpenHand = useRef(false);
  const pinchThreshold = 0.05; // This may need to be tweaked
  const openHandThreshold = 0.2; // This may need to be tweaked
  const swipeThreshold = 0.01; // This may need to be tweaked
  const lastLandmarks = useRef<any[] | null>(null);
  const lastTime = useRef<number>(0);
  const velocity = useRef({ x: 0, y: 0, z: 0 });
  const smoothingFactor = 0.5; // Exponential moving average smoothing factor

  useEffect(() => {
    const createGestureRecognizer = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
      );
      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
      setGestureRecognizer(recognizer);
    };
    createGestureRecognizer();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !gestureRecognizer) return;

    const constraints = {
      video: true,
    };

    let lastVideoTime = -1;

    const renderLoop = () => {
      if (video.currentTime !== lastVideoTime) {
        const now = Date.now();
        const deltaTime = now - lastTime.current;
        const results = gestureRecognizer.recognizeForVideo(video, now);
        const canvas = canvasRef.current;
        if (canvas) {
          const canvasCtx = canvas.getContext("2d");
          if (canvasCtx) {
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
            const drawingUtils = new DrawingUtils(canvasCtx);

            if (results.landmarks && results.landmarks.length > 0) {
              for (const landmarks of results.landmarks) {
                // Draw landmarks and connectors
                drawingUtils.drawConnectors(
                  landmarks,
                  GestureRecognizer.HAND_CONNECTIONS,
                  {
                    color: "#00FF00",
                    lineWidth: 5,
                  }
                );
                drawingUtils.drawLandmarks(landmarks, {
                  color: "#FF0000",
                  lineWidth: 2,
                });

                // Pinch gesture detection
                const thumbTip = landmarks[4];
                const indexTip = landmarks[8];
                const pinchDistance = Math.sqrt(
                  Math.pow(thumbTip.x - indexTip.x, 2) +
                    Math.pow(thumbTip.y - indexTip.y, 2) +
                    Math.pow(thumbTip.z - indexTip.z, 2)
                );

                if (pinchDistance < pinchThreshold) {
                  if (!isPinching.current) {
                    isPinching.current = true;
                    onGesture({
                      type: "pinch",
                      state: "start",
                      x: indexTip.x,
                      y: indexTip.y,
                    });
                  } else {
                    onGesture({
                      type: "pinch",
                      state: "move",
                      x: indexTip.x,
                      y: indexTip.y,
                    });
                  }
                } else {
                  if (isPinching.current) {
                    isPinching.current = false;
                    onGesture({
                      type: "pinch",
                      state: "end",
                      x: indexTip.x,
                      y: indexTip.y,
                    });
                  }
                }

                // Open hand gesture detection
                const palmCenter = landmarks[0];
                const fingerTips = [
                  landmarks[4],
                  landmarks[8],
                  landmarks[12],
                  landmarks[16],
                  landmarks[20],
                ];
                const distances = fingerTips.map((tip) =>
                  Math.sqrt(
                    Math.pow(tip.x - palmCenter.x, 2) +
                      Math.pow(tip.y - palmCenter.y, 2) +
                      Math.pow(tip.z - palmCenter.z, 2)
                  )
                );
                const avgDistance =
                  distances.reduce((a, b) => a + b, 0) / distances.length;

                if (avgDistance > openHandThreshold) {
                  if (!isOpenHand.current) {
                    isOpenHand.current = true;
                    onGesture({ type: "open_hand" });
                  }
                } else {
                  isOpenHand.current = false;
                }

                // Swipe gesture detection
                if (lastLandmarks.current && deltaTime > 0) {
                  const centroid = landmarks.reduce(
                    (acc, lm) => ({
                      x: acc.x + lm.x,
                      y: acc.y + lm.y,
                      z: acc.z + lm.z,
                    }),
                    { x: 0, y: 0, z: 0 }
                  );
                  centroid.x /= landmarks.length;
                  centroid.y /= landmarks.length;
                  centroid.z /= landmarks.length;

                  const lastCentroid = lastLandmarks.current.reduce(
                    (acc, lm) => ({
                      x: acc.x + lm.x,
                      y: acc.y + lm.y,
                      z: acc.z + lm.z,
                    }),
                    { x: 0, y: 0, z: 0 }
                  );
                  lastCentroid.x /= lastLandmarks.current.length;
                  lastCentroid.y /= lastLandmarks.current.length;
                  lastCentroid.z /= lastLandmarks.current.length;

                  const dx = (centroid.x - lastCentroid.x) / deltaTime;
                  const dy = (centroid.y - lastCentroid.y) / deltaTime;
                  const dz = (centroid.z - lastCentroid.z) / deltaTime;

                  // Apply exponential moving average for smoothing
                  velocity.current.x =
                    smoothingFactor * dx +
                    (1 - smoothingFactor) * velocity.current.x;
                  velocity.current.y =
                    smoothingFactor * dy +
                    (1 - smoothingFactor) * velocity.current.y;
                  velocity.current.z =
                    smoothingFactor * dz +
                    (1 - smoothingFactor) * velocity.current.z;

                  if (Math.abs(velocity.current.x) > swipeThreshold) {
                    onGesture({
                      type: "swipe",
                      direction: velocity.current.x > 0 ? "right" : "left",
                    });
                  }
                  if (Math.abs(velocity.current.y) > swipeThreshold) {
                    onGesture({
                      type: "swipe",
                      direction: velocity.current.y > 0 ? "down" : "up",
                    });
                  }
                }
                lastLandmarks.current = landmarks;
              }
            }
            canvasCtx.restore();
          }
        }
        lastVideoTime = video.currentTime;
        lastTime.current = now;
      }
      requestAnimationFrame(renderLoop);
    };

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      video.srcObject = stream;
      video.addEventListener("loadeddata", renderLoop);
    });

    return () => {
      const stream = video.srcObject as MediaStream;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [gestureRecognizer, onGesture]);

  return (
    <div>
      <video ref={videoRef} style={{ display: "none" }} autoPlay playsInline />
      <canvas ref={canvasRef} width="1280px" height="720px" />
    </div>
  );
};

export default GestureRecognition;
