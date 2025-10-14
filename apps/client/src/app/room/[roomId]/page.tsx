"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { socket } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";

import VideoChat from "@/components/VideoChat";
import Whiteboard from "@/components/Whiteboard";
import ThreeScene from "@/components/ThreeScene";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brush, Boxes, Loader2, Users, ArrowLeft } from "lucide-react";
import type { RTCDataChannelMessage } from "@/lib/types";
import { Button } from "@/components/ui/button";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const { toast } = useToast();

  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [isPeerConnected, setIsPeerConnected] = useState(false);

  const whiteboardRef = useRef<{ clear: () => void }>(null);
  const threeSceneRef = useRef<{ clear: () => void; resetCamera: () => void }>(
    null
  );

  useEffect(() => {
    if (!roomId) return;

    const onConnect = () => {
      setIsSocketConnected(true);
      console.log("Socket connected, joining room:", roomId);
      socket.emit("join-room", roomId);
    };

    const onConnectError = (err: Error) => {
      console.error("Socket connection error:", err.message);
      toast({
        title: "Connection Failed",
        description:
          "Could not connect to the signaling server. Please ensure it is running.",
        variant: "destructive",
      });
      router.push("/");
    };

    const onDisconnect = () => {
      setIsSocketConnected(false);
      console.log("Socket disconnected");
      setIsPeerConnected(false);
    };

    const onUserJoined = (userId: string) => {
      console.log("A new user joined:", userId);
      toast({
        title: "User Joined",
        description: "A new user has joined the room.",
      });
    };

    const onUserLeft = (userId: string) => {
      console.log("A user left:", userId);
      toast({
        title: "User Left",
        description: "The other user has left the room.",
      });
      setIsPeerConnected(false);
      setDataChannel(null); // Critical: Reset data channel
      // Also reset states of components
      whiteboardRef.current?.clear();
      threeSceneRef.current?.clear();
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    socket.on("user-joined", onUserJoined);
    socket.on("user-left", onUserLeft);

    if (!socket.connected) {
      socket.connect();
    } else {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
      socket.off("user-joined", onUserJoined);
      socket.off("user-left", onUserLeft);
      socket.disconnect();
    };
  }, [roomId, toast, router]);

  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    try {
      const message: RTCDataChannelMessage = JSON.parse(event.data);
      // Route message to the correct component
      if (message.type === "whiteboard") {
        window.dispatchEvent(
          new CustomEvent("whiteboard-message", { detail: message.payload })
        );
      } else if (message.type === "three") {
        window.dispatchEvent(
          new CustomEvent("three-message", { detail: message.payload })
        );
      }
    } catch (error) {
      console.error("Failed to parse data channel message:", error);
    }
  }, []);

  const handleDataChannelOpen = useCallback(() => {
    console.log("Data channel opened!");
    setIsPeerConnected(true);
    toast({
      title: "Peer Connected",
      description: "You can now collaborate.",
      variant: "default",
    });
  }, [toast]);

  const handleDataChannelClose = useCallback(() => {
    console.log("Data channel closed.");
    setIsPeerConnected(false);
    // Don't show toast here, as onUserLeft will handle it
  }, []);

  useEffect(() => {
    if (dataChannel) {
      dataChannel.addEventListener("message", handleDataChannelMessage);
      dataChannel.addEventListener("open", handleDataChannelOpen);
      dataChannel.addEventListener("close", handleDataChannelClose);

      return () => {
        dataChannel.removeEventListener("message", handleDataChannelMessage);
        dataChannel.removeEventListener("open", handleDataChannelOpen);
        dataChannel.removeEventListener("close", handleDataChannelClose);
      };
    }
  }, [
    dataChannel,
    handleDataChannelMessage,
    handleDataChannelOpen,
    handleDataChannelClose,
  ]);

  const onTabChange = (value: string) => {
    if (value === "3d-scene") {
      // Small delay to ensure tab content is rendered
      setTimeout(() => threeSceneRef.current?.resetCamera(), 50);
    }
  };

  if (!isSocketConnected) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center p-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-lg font-semibold text-foreground">
            Connecting to Collaboration Service...
          </p>
          <p className="text-muted-foreground max-w-sm">
            Please make sure the signaling server is running. You can start it
            with `npm run dev:server`.
          </p>
          <Button variant="outline" onClick={() => router.push("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col lg:flex-row bg-background overflow-hidden">
      <aside className="w-full lg:w-[380px] lg:flex-shrink-0 p-4 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold font-headline text-primary">
              Room:
            </h1>
          </div>
          <p
            className="text-lg font-mono bg-muted px-3 py-1 rounded-md truncate"
            title={roomId}
          >
            {roomId}
          </p>
        </header>
        <VideoChat
          socket={socket}
          roomId={roomId}
          onDataChannel={setDataChannel}
        />
      </aside>

      <main className="flex-1 p-4 pl-0 h-full min-w-0">
        <Card className="h-full w-full overflow-hidden shadow-lg">
          <Tabs
            defaultValue="whiteboard"
            className="flex flex-col h-full"
            onValueChange={onTabChange}
          >
            <div className="p-2 border-b">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="whiteboard">
                  <Brush className="mr-2 h-4 w-4" />
                  Whiteboard
                </TabsTrigger>
                <TabsTrigger value="3d-scene">
                  <Boxes className="mr-2 h-4 w-4" />
                  3D Scene
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent
              value="whiteboard"
              className="flex-1 mt-0 overflow-hidden relative"
            >
              {!isPeerConnected && <CollaborationOverlay />}
              <Whiteboard dataChannel={dataChannel} ref={whiteboardRef} />
            </TabsContent>

            <TabsContent
              value="3d-scene"
              className="flex-1 mt-0 overflow-hidden relative"
            >
              {!isPeerConnected && <CollaborationOverlay />}
              <ThreeScene dataChannel={dataChannel} ref={threeSceneRef} />
            </TabsContent>
          </Tabs>
        </Card>
      </main>
    </div>
  );
}

const CollaborationOverlay = () => (
  <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-b-lg">
    <div className="text-center p-4 rounded-lg">
      <p className="text-lg font-semibold text-foreground">
        Waiting for another user to connect...
      </p>
      <p className="text-muted-foreground mt-2">
        Collaboration tools will be enabled once a peer joins.
      </p>
    </div>
  </div>
);
