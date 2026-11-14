export interface Point {
  x: number;
  y: number;
  tool?: string;
  color?: string;
  lineWidth?: number;
}

export type ShapeType =
  | "pen"
  | "brush"
  | "eraser"
  | "rectangle"
  | "circle"
  | "line"
  | "arrow"
  | "text"
  | "image";

export interface ElementData {
  id?: string;
  userId?: string;
  type?: ShapeType;
  src?: string;
  points?: Point[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  rotation?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  fill?: string;
  lineWidth?: number;
  createdAt?: number;
  updatedAt?: number;
}

// Backward compatible alias
export type LineData = ElementData;

export type OperationType =
  | "element:create"
  | "element:update"
  | "element:delete"
  | "element:reorder"
  | "clearBoard"
  | "addImage";

export interface RoomOperation {
  version: number;
  type: OperationType;
  element?: ElementData;
  id?: string;
  patch?: Partial<ElementData>;
  to?: "front" | "back";
  image?: string | null;
  userId?: string;
  timestamp: number;
}

export interface AckResponse {
  success: boolean;
  version?: number;
  error?: string;
}

export function generateId(prefix = "el"): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${time}_${rand}`;
}

export interface User {
  id: string;
  name: string;
  color?: string;
}

export const USER_COLORS = [
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#14b8a6", // Teal
  "#e11d48", // Rose
  "#84cc16", // Lime
];

export function getUserColor(id: string): string {
  if (!id) return USER_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}
