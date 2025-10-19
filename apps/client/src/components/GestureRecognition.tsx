"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  GestureRecognizer,
  FilesetResolver,
  NormalizedLandmark,
  // Handedness,
} from "@mediapipe/tasks-vision";

// --- TYPES & INTERFACES ---
type RecognizerStatus = "INITIALIZING" | "READY" | "ERROR";
export type Axis = "x" | "y" | "z" | null;
export type Action = "fist" | "pinch" | "point" | "victory" | null;

// The data for a single hand
export interface HandData {
  handedness: "left" | "right";
  landmarks: NormalizedLandmark[];
  action: Action; // The action gesture (e.g., 'fist')
  axis: Axis; // The selected axis (e.g., 'x')
}

// The combined data for both hands that will be emitted
export interface TwoHandGestureData {
  left: HandData | null;
  right: HandData | null;
}

interface GestureRecognitionProps {
  onGesture: (data: TwoHandGestureData) => void;
  stream?: MediaStream;
}

// --- Finger constants for axis detection ---
const FINGER_TIPS = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };

// --- COMPONENT ---
const GestureRecognition: React.FC<GestureRecognitionProps> = ({
  onGesture,
  stream,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recognizer = useRef<GestureRecognizer | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const animationFrameId = useRef<number | null>(null);
  const [status, setStatus] = useState<RecognizerStatus>("INITIALIZING");

  // 1. Initialize the gesture recognizer
  useEffect(() => {
    const initialize = async () => {
      setStatus("INITIALIZING");
      console.log("Initializing 2-hand gesture recognizer...");
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );
        const gestureRecognizer = await GestureRecognizer.createFromOptions(
          vision,
          {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numHands: 2,
            // cannedGestures: true,
            minHandDetectionConfidence: 0.8,
          }
        );
        recognizer.current = gestureRecognizer;
        setStatus("READY");
        console.log("2-hand gesture recognizer is ready.");
      } catch (error) {
        setStatus("ERROR");
        console.error("Error initializing recognizer:", error);
      }
    };
    initialize();
    return () => recognizer.current?.close();
  }, []);

  // 2. Setup video stream and start prediction loop
  useEffect(() => {
    if (status !== "READY" || !stream || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = stream;
    const onVideoReady = () => {
      video.play();
      predict();
    };
    video.addEventListener("loadeddata", onVideoReady);
    return () => {
      video.removeEventListener("loadeddata", onVideoReady);
      if (animationFrameId.current)
        cancelAnimationFrame(animationFrameId.current);
    };
  }, [status, stream]);

  const getFingerCount = (landmarks: NormalizedLandmark[]): number => {
    let count = 0;
    // is the fingertip higher (lower y) than the joint below it?
    if (landmarks[FINGER_TIPS.THUMB].x < landmarks[FINGER_TIPS.THUMB - 2].x)
      count++;
    if (landmarks[FINGER_TIPS.INDEX].y < landmarks[FINGER_TIPS.INDEX - 2].y)
      count++;
    if (landmarks[FINGER_TIPS.MIDDLE].y < landmarks[FINGER_TIPS.MIDDLE - 2].y)
      count++;
    if (landmarks[FINGER_TIPS.RING].y < landmarks[FINGER_TIPS.RING - 2].y)
      count++;
    if (landmarks[FINGER_TIPS.PINKY].y < landmarks[FINGER_TIPS.PINKY - 2].y)
      count++;
    return count;
  };

  const getAxisFromFingerCount = (count: number): Axis => {
    if (count === 1) return "x";
    if (count === 2) return "y";
    if (count === 3) return "z";
    return null;
  };

  const getActionFromGesture = (gestureName: string): Action => {
    const gestureMap: { [key: string]: Action } = {
      Closed_Fist: "fist",
      Pointing_Up: "point",
      Victory: "victory",
      Pinched: "pinch",
    };
    return gestureMap[gestureName] || null;
  };

  const isPinched = (landmarks: NormalizedLandmark[]): boolean => {
    const thumbTip = landmarks[FINGER_TIPS.THUMB];
    const indexTip = landmarks[FINGER_TIPS.INDEX];
    const distance = Math.hypot(
      thumbTip.x - indexTip.x,
      thumbTip.y - indexTip.y
    );
    return distance < 0.05; // pinch threshold
  };

  // 3. The prediction loop
  const predict = () => {
    const video = videoRef.current;
    const gestureRec = recognizer.current;
    if (!video || !gestureRec || video.paused) {
      animationFrameId.current = requestAnimationFrame(predict);
      return;
    }

    const now = performance.now();
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      if (!gestureRec || video.readyState < 2) {
        animationFrameId.current = requestAnimationFrame(predict);
        return;
      }

      const results = gestureRec.recognizeForVideo(video, now);

      const twoHandData: TwoHandGestureData = { left: null, right: null };

      if (results.handedness.length > 0) {
        // only process data for each detected hand
        results.handedness.forEach((hand, index) => {
          const handedness = hand[0].categoryName.toLowerCase() as
            | "left"
            | "right";
          const landmarks = results.landmarks[index];
          const gesture = results.gestures[index]?.[0]?.categoryName || "";

          let action = getActionFromGesture(gesture);
          if (isPinched(landmarks)) {
            action = "pinch";
          }

          const fingerCount = getFingerCount(landmarks);
          const axis = getAxisFromFingerCount(fingerCount);

          twoHandData[handedness] = { handedness, landmarks, action, axis };
        });
      }

      onGesture(twoHandData);
    }
    animationFrameId.current = requestAnimationFrame(predict);
  };

  return (
    <video
      ref={videoRef}
      style={{ display: "none" }}
      autoPlay
      playsInline
      muted
    />
  );
};

export default GestureRecognition;
