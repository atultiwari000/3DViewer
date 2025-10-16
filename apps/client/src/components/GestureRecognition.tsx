"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  GestureRecognizer,
  FilesetResolver,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

// --- TYPES & INTERFACES ---
type RecognizerStatus = "INITIALIZING" | "READY" | "ERROR";

export interface GestureData {
  gesture: string;
  landmarks: NormalizedLandmark[];
}

interface GestureRecognitionProps {
  onGesture: (data: GestureData) => void;
  stream?: MediaStream;
}

// --- COMPONENT ---
const GestureRecognition: React.FC<GestureRecognitionProps> = ({
  onGesture,
  stream,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const gestureRecognizer = useRef<GestureRecognizer | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const animationFrameId = useRef<number | null>(null);
  const [status, setStatus] = useState<RecognizerStatus>("INITIALIZING");

  // 1. Initialize the Gesture Recognizer
  useEffect(() => {
    const initializeRecognizer = async () => {
      setStatus("INITIALIZING");
      console.log("⏳ Initializing gesture recognizer (v2)...");
      try {
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
          numHands: 1, // Focusing on one hand simplifies control
          minHandDetectionConfidence: 0.7, // Higher confidence to reduce flicker
        });
        gestureRecognizer.current = recognizer;
        setStatus("READY");
        console.log("✅ Gesture recognizer is ready.");
      } catch (error) {
        setStatus("ERROR");
        console.error("❌ Error initializing gesture recognizer:", error);
      }
    };

    initializeRecognizer();

    return () => {
      console.log("🧹 Cleaning up gesture recognizer.");
      gestureRecognizer.current?.close();
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  // 2. Setup video and start prediction loop when ready
  useEffect(() => {
    if (status !== "READY" || !stream || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    video.srcObject = stream;

    const onVideoReady = () => {
      console.log(
        `📹 Video stream ready for prediction: ${video.videoWidth}x${video.videoHeight}`
      );
      video.play();
      predictWebcam(); // Start the loop
    };

    video.addEventListener("loadeddata", onVideoReady);

    return () => {
      console.log("🛑 Stopping video stream and prediction loop.");
      video.removeEventListener("loadeddata", onVideoReady);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [status, stream]);

  // 3. The Prediction Loop - Main Logic
  const predictWebcam = () => {
    const video = videoRef.current;
    const recognizer = gestureRecognizer.current;

    if (!video || video.paused || !recognizer) {
      animationFrameId.current = requestAnimationFrame(predictWebcam);
      return;
    }

    const now = performance.now();
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const results = recognizer.recognizeForVideo(video, now);

      // --- CHANGE START: Use built-in gestures and emit structured data ---
      if (results.gestures.length > 0 && results.landmarks.length > 0) {
        const topGesture = results.gestures[0][0]; // Get the most likely gesture
        const landmarks = results.landmarks[0];
        const gestureName = topGesture.categoryName;

        // Map MediaPipe's names to our simplified names
        const recognizedGestures: { [key: string]: string } = {
          Closed_Fist: "fist",
          Pinching: "pinch", // Note: MediaPipe may use "Pinching" or similar
          Pointing_Up: "point",
          Victory: "victory",
          // We can ignore others like 'Open_Palm', 'Thumb_Up', etc.
        };

        const ourGesture = recognizedGestures[gestureName];

        if (ourGesture) {
          // Emit the structured data for the parent component to handle
          onGesture({
            gesture: ourGesture,
            landmarks: landmarks,
          });
        }
      }
      // --- CHANGE END ---
    }

    animationFrameId.current = requestAnimationFrame(predictWebcam);
  };

  return (
    <video
      ref={videoRef}
      style={{ display: "none" }} // Video is processed, not displayed
      autoPlay
      playsInline
      muted
    />
  );
};

export default GestureRecognition;
