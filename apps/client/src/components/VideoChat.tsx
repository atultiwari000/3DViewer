"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Mic, MicOff, Video, VideoOff, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VideoChatProps {
  socket: Socket;
  roomId: string;
  onDataChannel: (dataChannel: RTCDataChannel) => void;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const VideoChat: React.FC<VideoChatProps> = ({
  socket,
  roomId,
  onDataChannel,
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);

  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const { toast } = useToast();

  const createPeerConnection = useCallback(
    (userId: string, isInitiator: boolean) => {
      console.log(
        `Creating peer connection for ${userId}, initiator: ${isInitiator}`
      );
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current[userId] = pc;

      localStreamRef.current?.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, localStreamRef.current!);
        } catch (error) {
          console.error("Error adding track:", error);
        }
      });

      pc.ontrack = (event) => {
        console.log("Received remote track");
        if (remoteVideoRef.current) {
          const stream = event.streams[0];
          remoteVideoRef.current.srcObject = stream;
          setRemoteStream(stream);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            to: userId,
            candidate: event.candidate,
          });
        }
      };

      if (isInitiator) {
        const dataChannel = pc.createDataChannel("collaboration");
        onDataChannel(dataChannel);
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit("offer", { to: userId, offer: pc.localDescription });
          })
          .catch((e) => console.error("Create offer error", e));
      } else {
        pc.ondatachannel = (event) => {
          onDataChannel(event.channel);
        };
      }

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed" ||
          pc.connectionState === "failed"
        ) {
          // Peer connection lost
          if (peerConnections.current[userId]) {
            peerConnections.current[userId].close();
            delete peerConnections.current[userId];
          }
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          setRemoteStream(null);
        }
      };

      return pc;
    },
    [onDataChannel, socket]
  );

  useEffect(() => {
    const setupMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        socket.emit("join-room", roomId);
      } catch (error) {
        console.error("Error accessing media devices.", error);
        toast({
          title: "Media Error",
          description:
            "Could not access camera or microphone. Please check permissions.",
          variant: "destructive",
        });
      }
    };

    setupMedia();

    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
    };
  }, [roomId, socket, toast]);

  useEffect(() => {
    socket.on("existing-users", (users: string[]) => {
      console.log("Existing users to connect to:", users);
      users.forEach((userId) => {
        createPeerConnection(userId, true);
      });
    });

    socket.on("user-joined", (userId) => {
      console.log("New user joined, I am the existing user", userId);
      // This logic is now handled by existing-users for the new joiner.
      // The existing user will create a connection when they receive an offer.
    });

    socket.on("offer", async ({ from, offer }) => {
      console.log(`Received offer from ${from}`);
      const pc = createPeerConnection(from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { to: from, answer: pc.localDescription });
    });

    socket.on("answer", async ({ from, answer }) => {
      console.log(`Received answer from ${from}`);
      const pc = peerConnections.current[from];
      if (pc && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on("ice-candidate", async ({ from, candidate }) => {
      const pc = peerConnections.current[from];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding received ICE candidate", e);
        }
      }
    });

    socket.on("user-left", (userId) => {
      if (peerConnections.current[userId]) {
        peerConnections.current[userId].close();
        delete peerConnections.current[userId];
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setRemoteStream(null);
    });

    return () => {
      socket.off("existing-users");
      socket.off("user-joined");
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("user-left");
    };
  }, [socket, createPeerConnection]);

  const toggleAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current
        .getAudioTracks()
        .forEach((track) => (track.enabled = !track.enabled));
      setIsAudioMuted((prev) => !prev);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current
        .getVideoTracks()
        .forEach((track) => (track.enabled = !track.enabled));
      setIsVideoOff((prev) => !prev);
    }
  };

  return (
    <Card className="flex-1 flex flex-col shadow-md">
      <CardContent className="p-4 flex-1 flex flex-col gap-4">
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden flex-1 group">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
          {!remoteStream && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-secondary">
              <User className="w-16 h-16" />
              <p className="mt-2 font-medium">Waiting for peer...</p>
            </div>
          )}
          <p className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
            Peer
          </p>
        </div>
        <div className="flex gap-4 items-end">
          <div className="relative aspect-video bg-muted rounded-lg overflow-hidden w-1/3 self-end group">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            <p className="absolute bottom-1 left-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
              You
            </p>
          </div>
          <div className="flex justify-center gap-2 flex-1 pb-2">
            <Button
              onClick={toggleAudio}
              variant={isAudioMuted ? "destructive" : "secondary"}
              size="icon"
            >
              {isAudioMuted ? <MicOff /> : <Mic />}
              <span className="sr-only">
                {isAudioMuted ? "Unmute" : "Mute"} audio
              </span>
            </Button>
            <Button
              onClick={toggleVideo}
              variant={isVideoOff ? "destructive" : "secondary"}
              size="icon"
            >
              {isVideoOff ? <VideoOff /> : <Video />}
              <span className="sr-only">
                {isVideoOff ? "Turn on" : "Turn off"} video
              </span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default VideoChat;
