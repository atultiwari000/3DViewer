import React, { useRef, useEffect } from "react";
// import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { TwoHandGestureData } from "./GestureRecognition";
import { DrawingUtils } from "@mediapipe/tasks-vision";
import { HAND_CONNECTIONS } from "@mediapipe/hands";

interface VideoFeedProps {
  stream: MediaStream;
  isMuted: boolean;
  label: string;
  gestureData?: TwoHandGestureData | null;
}

const VideoFeed: React.FC<VideoFeedProps> = ({
  stream,
  isMuted,
  label,
  gestureData,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const canvasCtx = canvas?.getContext("2d");

    if (!video || !canvas || !canvasCtx) {
      return;
    }

    const onResize = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    };

    const drawSkeletons = () => {
      if (canvas.width !== video.clientWidth) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }

      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      // if (gestureData) {
      //   //
      // }
    };

    let animationFrameId: number;
    const renderLoop = () => {
      if (video.HAVE_ENOUGH_DATA) {
        drawSkeletons();
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    window.addEventListener("resize", onResize);
    onResize();

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [gestureData]);

  return (
    <div className="relative w-60 h-44 bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className="w-full h-full object-cover rounded-lg transform -scale-x-100"
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full transform -scale-x-100"
      />
      <p className="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded-md text-sm font-semibold">
        {label}
      </p>
    </div>
  );
};

export default VideoFeed;
