"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface VideoFeedProps {
  stream: MediaStream | null;
  isMuted: boolean;
  label: string;
}

export default function VideoFeed({ stream, isMuted, label }: VideoFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;

      // Attempt to play the video
      videoRef.current
        .play()
        .then(() => {
          console.log(`✅ Video playing for: ${label}`);
          setIsPlaying(true);
        })
        .catch((error) => {
          console.error(`❌ Error playing video for ${label}:`, error);
          setIsPlaying(false);
        });
    } else {
      setIsPlaying(false);
    }

    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream, label]);

  // Don't render anything until stream is available
  if (!stream) {
    return null;
  }

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0}
      className={`relative rounded-lg overflow-hidden shadow-xl border-2 border-white`}
      style={{ width: "192px", height: "144px" }}
      whileHover={{ scale: 1.02 }}
      whileDrag={{ scale: 1.05, cursor: "grabbing" }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className="w-48 h-36 object-cover bg-gray-900"
        style={{
          transform: "scaleX(-1)",
          zIndex: 10, // Mirror the video
        }}
      />

      {/* Label overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs px-2 py-1 text-center">
        {label}
        {!isPlaying && (
          <span className="ml-1 text-yellow-400">(Loading...)</span>
        )}
      </div>

      {/* Muted indicator */}
      {/* {isMuted && (
        <div className="absolute top-2 right-2 bg-red-500 rounded-full p-1">
          <svg
            className="w-4 h-4 text-white"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )} */}
    </motion.div>
  );
}
