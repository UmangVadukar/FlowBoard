import React from "react";
import {
  Pencil,
  Square,
  Circle,
  ArrowRight,
  Minus,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Download,
  Upload,
  Trash2,
  MousePointer,
  Hand,
} from "lucide-react";

interface ToolbarProps {
  tool: string;
  setTool: (tool: string) => void;
  color: string;
  setColor: (color: string) => void;
  lineWidth: number;
  setLineWidth: (width: number) => void;
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  undo: () => void;
  redo: () => void;
  exportImage: () => void;
  clearBoard: () => void;
}

const PRESET_COLORS = [
  "#1e1e1e", // Black
  "#64748b", // Slate
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#3b82f6", // Blue
  "#a855f7", // Purple
];

const STROKE_WIDTHS = [
  { label: "S", value: 2 },
  { label: "M", value: 5 },
  { label: "L", value: 10 },
];

const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  setTool,
  color,
  setColor,
  lineWidth,
  setLineWidth,
  handleImageUpload,
  undo,
  redo,
  exportImage,
  clearBoard,
}) => {
  const tools = [
    { id: "select", icon: MousePointer, label: "Select (V)" },
    { id: "hand", icon: Hand, label: "Pan (H)" },
    { id: "pen", icon: Pencil, label: "Draw (P)" },
    { id: "rectangle", icon: Square, label: "Rectangle (R)" },
    { id: "circle", icon: Circle, label: "Circle (C)" },
    { id: "arrow", icon: ArrowRight, label: "Arrow (A)" },
    { id: "line", icon: Minus, label: "Line (L)" },
    { id: "text", icon: Type, label: "Text (T)" },
    { id: "eraser", icon: Eraser, label: "Eraser (E)" },
  ];

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      {/* Secondary Properties Bar (Color & Stroke Width) */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-md border border-gray-200/80 dark:border-gray-700/80 transition-all">
        {/* Color Swatches */}
        <div className="flex items-center gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              title={c}
              className={`w-5 h-5 rounded-full transition-transform hover:scale-110 border ${
                color.toLowerCase() === c.toLowerCase()
                  ? "ring-2 ring-blue-500 ring-offset-1 scale-110 border-white"
                  : "border-gray-300 dark:border-gray-600"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}

          {/* Custom Color Picker */}
          <label
            title="Custom color"
            className="w-5 h-5 rounded-full cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 hover:scale-110 transition-transform relative"
            style={{
              background:
                "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
            }}
          >
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
            />
          </label>
        </div>

        <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

        {/* Stroke Width Selector */}
        <div className="flex items-center gap-1">
          {STROKE_WIDTHS.map((sw) => (
            <button
              key={sw.value}
              type="button"
              onClick={() => setLineWidth(sw.value)}
              className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold transition-colors ${
                lineWidth === sw.value
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              {sw.label}
            </button>
          ))}
        </div>
      </div>

      {/* Primary Tool Dock */}
      <div className="flex items-center gap-1 px-2.5 py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200/80 dark:border-gray-700/80">
        {/* Drawing & Shape Tools */}
        <div className="flex items-center gap-0.5">
          {tools.map((t) => {
            const Icon = t.icon;
            const isActive = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                title={t.label}
                className={`p-2 rounded-xl transition-all ${
                  isActive
                    ? "bg-blue-600 text-white shadow-md scale-105"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/70"
                }`}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </div>

        <div className="w-[1px] h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

        {/* Image Upload */}
        <label
          htmlFor="image-upload"
          title="Insert image"
          className="p-2 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/70 cursor-pointer transition-colors mb-0"
        >
          <Upload className="w-5 h-5" />
        </label>
        <input
          id="image-upload"
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />

        <div className="w-[1px] h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={undo}
            title="Undo"
            className="p-2 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors"
          >
            <Undo2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={redo}
            title="Redo"
            className="p-2 rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors"
          >
            <Redo2 className="w-5 h-5" />
          </button>
        </div>

        <div className="w-[1px] h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

        {/* Export & Clear */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={exportImage}
            title="Export Image"
            className="p-2 rounded-xl text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Are you sure you want to clear the entire whiteboard?")) {
                clearBoard();
              }
            }}
            title="Clear canvas"
            className="p-2 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
