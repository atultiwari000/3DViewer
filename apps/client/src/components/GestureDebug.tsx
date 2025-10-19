import React from "react";
import { TwoHandGestureData, HandData } from "./GestureRecognition";

interface GestureDebugProps {
  gestureData: TwoHandGestureData | null;
}

const LeftHandDebug: React.FC<{ hand: HandData | null }> = ({ hand }) => {
  if (!hand) {
    return (
      <div className="w-40 h-28 bg-gray-700 rounded-lg p-3 flex flex-col items-center justify-center">
        <div className="font-bold text-lg">Left Hand</div>
        <div className="text-sm text-gray-400 mt-1">Not Detected</div>
        <div className="text-xs text-gray-500 mt-2">(Axis Control)</div>
      </div>
    );
  }

  const axisColors: Record<string, string> = {
    x: "text-red-400",
    y: "text-green-400",
    z: "text-blue-400",
  };

  return (
    <div className="w-40 h-28 bg-gray-800 border-2 border-green-500 rounded-lg p-3 flex flex-col justify-between">
      <div className="font-bold text-lg">Left Hand</div>
      <div>
        <div className="text-sm">
          <span className="font-semibold">Axis:</span>{" "}
          <span
            className={`font-bold text-lg ${
              axisColors[hand.axis || ""] || "text-gray-400"
            }`}
          >
            {hand.axis?.toUpperCase() || "None"}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {hand.axis === "x" && "← → X-Axis"}
          {hand.axis === "y" && "↑ ↓ Y-Axis"}
          {hand.axis === "z" && "⇄ Z-Axis"}
          {!hand.axis && "Show fingers: 1=X, 2=Y, 3=Z"}
        </div>
      </div>
    </div>
  );
};

const RightHandDebug: React.FC<{ hand: HandData | null }> = ({ hand }) => {
  if (!hand) {
    return (
      <div className="w-40 h-28 bg-gray-700 rounded-lg p-3 flex flex-col items-center justify-center">
        <div className="font-bold text-lg">Right Hand</div>
        <div className="text-sm text-gray-400 mt-1">Not Detected</div>
        <div className="text-xs text-gray-500 mt-2">(Action Control)</div>
      </div>
    );
  }

  const actionEmojis: Record<string, string> = {
    fist: "✊",
    pinch: "🤏",
    point: "👆",
    victory: "✌️",
  };

  const actionLabels: Record<string, string> = {
    fist: "Move",
    pinch: "Scale",
    point: "Rotate",
    victory: "Pan Camera",
  };

  return (
    <div className="w-40 h-28 bg-gray-800 border-2 border-blue-500 rounded-lg p-3 flex flex-col justify-between">
      <div className="font-bold text-lg">Right Hand</div>
      <div>
        <div className="text-sm flex items-center gap-2">
          {/* <span className="text-2xl">
            {actionEmojis[hand.action || ""] || "👋"}
          </span> */}
          <span className="font-semibold">
            {actionLabels[hand.action || ""] || "No Action"}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {!hand.action && "Make a gesture"}
        </div>
      </div>
    </div>
  );
};

const GestureDebug: React.FC<GestureDebugProps> = ({ gestureData }) => {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-black bg-opacity-70 text-white p-4 rounded-xl shadow-2xl flex gap-4 z-50 pointer-events-none">
      <LeftHandDebug hand={gestureData?.left || null} />
      <RightHandDebug hand={gestureData?.right || null} />
    </div>
  );
};

export default GestureDebug;
