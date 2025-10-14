"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Boxes } from "lucide-react";

export default function HomePage() {
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      router.push(`/room/${roomId.trim()}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Boxes className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-3xl font-headline text-primary">
            CollabCanvas3D
          </CardTitle>
          <CardDescription className="pt-2">
            Join a room to start collaborating in real-time.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleJoinRoom}>
          <CardContent>
            <div className="grid w-full items-center gap-4">
              <div className="flex flex-col space-y-2">
                <Label htmlFor="room-id" className="text-left">
                  Room ID
                </Label>
                <Input
                  id="room-id"
                  placeholder="e.g., 'design-sprint-123'"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  required
                />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={!roomId.trim()}>
              Join Room
            </Button>
          </CardFooter>
        </form>
      </Card>
      <footer className="absolute bottom-4 text-center text-sm text-muted-foreground">
        <p>Created for local, peer-to-peer collaboration.</p>
      </footer>
    </main>
  );
}
