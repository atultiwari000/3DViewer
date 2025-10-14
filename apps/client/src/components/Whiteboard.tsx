"use client";

import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { Button } from "./ui/button";
import { Trash2 } from "lucide-react";
import type { RTCDataChannelMessage } from "@/lib/types";

interface WhiteboardProps {
  dataChannel: RTCDataChannel | null;
}

interface Point {
  x: number;
  y: number;
}

const Whiteboard = forwardRef(({ dataChannel }: WhiteboardProps, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);

  const clearLocalCanvas = () => {
    if (contextRef.current && canvasRef.current) {
      const dpr = window.devicePixelRatio || 1;
      contextRef.current.clearRect(
        0,
        0,
        canvasRef.current.width / dpr,
        canvasRef.current.height / dpr
      );
    }
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      clearLocalCanvas();
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setCanvasDimensions = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;

        const context = canvas.getContext("2d");
        if (!context) return;

        context.scale(dpr, dpr);
        context.lineCap = "round";
        context.strokeStyle = "#3F51B5"; // Primary color
        context.lineWidth = 5;
        contextRef.current = context;
      }
    };

    const resizeObserver = new ResizeObserver(setCanvasDimensions);
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }
    setCanvasDimensions();

    return () => {
      if (canvas.parentElement) {
        resizeObserver.unobserve(canvas.parentElement);
      }
    };
  }, []);

  const sendData = (payload: any) => {
    if (dataChannel && dataChannel.readyState === "open") {
      const message: RTCDataChannelMessage = { type: "whiteboard", payload };
      dataChannel.send(JSON.stringify(message));
    }
  };

  const drawLine = (from: Point, to: Point) => {
    if (!contextRef.current) return;
    contextRef.current.beginPath();
    contextRef.current.moveTo(from.x, from.y);
    contextRef.current.lineTo(to.x, to.y);
    contextRef.current.stroke();
  };

  useEffect(() => {
    const handleWhiteboardMessage = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { action, from, to } = customEvent.detail;
      if (action === "draw" && from && to) {
        drawLine(from, to);
      } else if (action === "clear") {
        clearLocalCanvas();
      }
    };
    window.addEventListener("whiteboard-message", handleWhiteboardMessage);
    return () =>
      window.removeEventListener("whiteboard-message", handleWhiteboardMessage);
  }, []);

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dataChannel || dataChannel.readyState !== "open") return;
    isDrawingRef.current = true;
    lastPointRef.current = getMousePos(e);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const currentPoint = getMousePos(e);
    if (lastPointRef.current) {
      drawLine(lastPointRef.current, currentPoint);
      sendData({
        action: "draw",
        from: lastPointRef.current,
        to: currentPoint,
      });
    }
    lastPointRef.current = currentPoint;
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const clearCanvasAndBroadcast = () => {
    clearLocalCanvas();
    sendData({ action: "clear" });
  };

  return (
    <div className="h-full w-full relative bg-white rounded-b-lg">
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        className="h-full w-full cursor-crosshair"
      />
      <div className="absolute top-4 right-4">
        <Button
          onClick={clearCanvasAndBroadcast}
          variant="secondary"
          size="sm"
          disabled={!dataChannel || dataChannel.readyState !== "open"}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>
    </div>
  );
});

Whiteboard.displayName = "Whiteboard";

export default Whiteboard;
