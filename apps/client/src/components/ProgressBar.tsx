import React from "react";

interface ProgressBarProps {
  uploading: boolean;
  progress: number;
  fileName: string;
  type: "upload" | "download";
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  uploading,
  progress,
  fileName,
  type,
}) => {
  // Hide after completion
  if (!uploading && progress === 0) return null;
  if (!uploading && progress === 100) return null;

  const isComplete = progress === 100;
  const bgColor = type === "upload" ? "bg-blue-500" : "bg-green-500";
  const icon = type === "upload" ? "📤" : "📥";

  return (
    <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-gray-800 rounded-lg shadow-2xl p-4 min-w-[300px] max-w-md">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <p className="text-white font-semibold text-sm">
            {isComplete
              ? "Complete!"
              : `${type === "upload" ? "Uploading" : "Downloading"}...`}
          </p>
          <p className="text-gray-400 text-xs truncate">{fileName}</p>
        </div>
      </div>

      <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full ${bgColor} transition-all duration-300 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-gray-400 text-xs text-right mt-1">{progress}%</p>
    </div>
  );
};

export default ProgressBar;
