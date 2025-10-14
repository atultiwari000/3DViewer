"use client";

import { motion } from "framer-motion";
import React, { useRef, useEffect } from "react";

interface VideoFeedProps {
  stream: MediaStream;
  isMuted: boolean;
  label?: string;
}

export default function VideoFeed({ stream, isMuted, label }: VideoFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0}
      className="rounded-lg shadow-lg overflow-hidden bg-gray-900 cursor-grab active:cursor-grabbing relative"
      style={{
        width: "200px",
        height: "150px",
      }}
      whileHover={{ scale: 1.02 }}
      whileDrag={{ scale: 1.05, cursor: "grabbing" }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMuted}
        className="w-full h-full object-cover"
      />
      {label && (
        <div className="absolute bottom-2 left-2 text-white text-xs bg-black bg-opacity-60 px-2 py-1 rounded pointer-events-none">
          {label}
        </div>
      )}
    </motion.div>
  );
}
