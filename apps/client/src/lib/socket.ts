import { io, Socket } from "socket.io-client";
import { useRef, useEffect } from "react";

const URL = process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || 'http://localhost:3001';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(URL, {
        autoConnect: true,
        reconnectionAttempts: 5
      });

      socketRef.current.on("connect", () => {
        console.log("Connected:", socketRef.current?.id);
      });

      socketRef.current.on("disconnect", (reason) => {
        console.log("Disconnected:", reason);
      });
    }

    const socket = socketRef.current;

    return () => {
      socket?.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef.current;
}
