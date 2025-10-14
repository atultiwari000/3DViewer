import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", socket => {
  console.log("Client connected", socket.id);

  socket.on("join", (room: string) => {
    socket.join(room);
    socket.to(room).emit("peer-joined", socket.id);
  });

  socket.on("signal", ({ room, data }) => {
    socket.to(room).emit("signal", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected", socket.id);
  });
});

httpServer.listen(3001, () => {
  console.log("Signaling server running on http://localhost:3001");
});
