import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  Stage,
  Layer,
  Line,
  Rect,
  Circle as KonvaCircle,
  Arrow,
  Text as KonvaText,
  Image as KonvaImage,
  Group,
  Path,
  Transformer,
} from "react-konva";
import useImage from "use-image";
import { ElementData, Point, getUserColor, generateId, ShapeType } from "@/types/types";
import { emitWithAck } from "@/utils/socketUtils";
import throttle from "lodash/throttle";
import { Socket } from "socket.io-client";
import Konva from "konva";
import {
  Trash2,
  Copy,
  ChevronsUp,
  ChevronsDown,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface Cursor {
  x: number;
  y: number;
  id: string;
  name: string;
  color?: string;
}

interface WhiteboardCanvasProps {
  tool: string;
  color: string;
  lineWidth: number;
  imageSrc: string | null;
  lines: ElementData[];
  setLines: React.Dispatch<React.SetStateAction<ElementData[]>>;
  socket: Socket | null;
  roomId: string;
  stageRef: React.MutableRefObject<Konva.Stage | null>;
  onElementCreated?: (element: ElementData) => void;
  onVersionUpdate?: (version: number) => void;
}

const PRESET_PALETTE = [
  "#1e1e1e",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
];

// Interactive canvas image component
const CanvasImageItem: React.FC<{
  id: string;
  el: ElementData;
  isDraggable: boolean;
  onMouseEnter?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseLeave?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onClick?: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onTap?: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
}> = ({ id, el, isDraggable, ...handlers }) => {
  const [img] = useImage(el.src || "", "anonymous");
  return (
    <KonvaImage
      id={id}
      image={img}
      x={el.x || 0}
      y={el.y || 0}
      width={el.width || (img ? img.width : 200)}
      height={el.height || (img ? img.height : 200)}
      rotation={el.rotation || 0}
      draggable={isDraggable}
      {...handlers}
    />
  );
};

const WhiteboardCanvas: React.FC<WhiteboardCanvasProps> = ({
  tool,
  color,
  lineWidth,
  imageSrc,
  lines,
  setLines,
  socket,
  roomId,
  stageRef,
  onElementCreated,
  onVersionUpdate,
}) => {
  const [currentLine, setCurrentLine] = useState<Point[]>([]);
  const [currentShape, setCurrentShape] = useState<ElementData | null>(null);
  const [liveDrawings, setLiveDrawings] = useState<Record<string, ElementData>>({});
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBox, setSelectedBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Infinite canvas zoom and pan state
  const [stageScale, setStageScale] = useState<number>(1);
  const [stagePos, setStagePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPanning = useRef<boolean>(false);
  const panStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isSpacePressed = useRef<boolean>(false);
  const [isSpaceActive, setIsSpaceActive] = useState<boolean>(false);

  const isDrawing = useRef(false);
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const trRef = useRef<Konva.Transformer | null>(null);
  const currentLineRef = useRef<Point[]>([]);
  const activeElementId = useRef<string | null>(null);

  // Throttled socket emitters (reduces thousands of events/sec)
  const throttledMouseMove = useRef(
    throttle((s: Socket, rId: string, x: number, y: number) => {
      s.emit("mouseMove", { roomId: rId, x, y });
    }, 40)
  ).current;

  const throttledDrawProgress = useRef(
    throttle(
      (
        s: Socket,
        payload: { roomId: string; point?: Point; element?: ElementData }
      ) => {
        s.emit("drawProgress", payload);
      },
      30
    )
  ).current;

  const throttledShapeMove = useRef(
    throttle(
      (s: Socket, rId: string, id: string, x: number, y: number) => {
        s.emit("shapeMove", { roomId: rId, id, x, y });
      },
      35
    )
  ).current;

  useEffect(() => {
    return () => {
      throttledMouseMove.cancel();
      throttledDrawProgress.cancel();
      throttledShapeMove.cancel();
    };
  }, [throttledMouseMove, throttledDrawProgress, throttledShapeMove]);

  // Track spacebar for quick canvas panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space" && !isSpacePressed.current) {
        isSpacePressed.current = true;
        setIsSpaceActive(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        isSpacePressed.current = false;
        setIsSpaceActive(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Inline text input state
  const [textInput, setTextInput] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
    editingId?: string;
  } | null>(null);

  const [dimensions, setDimensions] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });

  // Handle dynamic window resizing
  useEffect(() => {
    const updateSize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Synchronize legacy background image display if present
  useEffect(() => {
    if (imageSrc) {
      const img = new window.Image();
      img.src = imageSrc;
      img.onload = () => setLoadedImage(img);
    } else {
      setLoadedImage(null);
    }
  }, [imageSrc]);

  // Deselect if active tool is not 'select'
  useEffect(() => {
    if (tool !== "select") {
      setSelectedId(null);
      setSelectedBox(null);
    }
  }, [tool]);

  // Convert screen coordinates to infinite canvas world coordinates
  const getWorldPointer = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: Math.round((pointer.x - stagePos.x) / stageScale),
      y: Math.round((pointer.y - stagePos.y) / stageScale),
    };
  }, [stageRef, stagePos, stageScale]);

  // Infinite zoom centered at pointer position
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Smooth logarithmic zoom
    const zoomFactor = 1.08;
    const direction = e.evt.deltaY < 0 ? 1 : -1;
    const newScale = direction > 0 ? oldScale * zoomFactor : oldScale / zoomFactor;

    // Virtually unlimited zoom: 2% to 5000%
    const boundedScale = Math.max(0.02, Math.min(50, newScale));

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    const newPos = {
      x: Math.round(pointer.x - mousePointTo.x * boundedScale),
      y: Math.round(pointer.y - mousePointTo.y * boundedScale),
    };

    setStageScale(boundedScale);
    setStagePos(newPos);
  };

  // Recalculate selected shape bounding box for floating action bar
  const updateSelectedBox = useCallback(() => {
    if (!selectedId || tool !== "select") {
      setSelectedBox(null);
      return;
    }
    const stage = stageRef.current;
    if (!stage) {
      setSelectedBox(null);
      return;
    }
    const node = stage.findOne("#" + selectedId);
    if (node) {
      const box = node.getClientRect({ skipTransform: false });
      setSelectedBox({
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    } else {
      setSelectedBox(null);
    }
  }, [selectedId, tool, stageRef]);

  // Attach/detach Konva Transformer to selected node
  useEffect(() => {
    if (!trRef.current) return;
    const tr = trRef.current;
    const stage = stageRef.current || tr.getStage();

    if (tool === "select" && selectedId && stage) {
      const selectedNode = stage.findOne("#" + selectedId);
      if (selectedNode) {
        tr.nodes([selectedNode]);
        tr.getLayer()?.batchDraw();
        updateSelectedBox();
        return;
      }
    }
    tr.nodes([]);
    tr.getLayer()?.batchDraw();
    setSelectedBox(null);
  }, [selectedId, tool, lines, stageRef, updateSelectedBox]);

  // Handle remote cursors & live real-time drawings & element updates
  useEffect(() => {
    if (!socket) return;

    socket.on("mouseUpdate", (data: Cursor) => {
      setCursors((prevCursors) => {
        const updatedCursors = prevCursors.filter((c) => c.id !== data.id);
        return [...updatedCursors, data];
      });
    });

    socket.on(
      "drawStart",
      ({
        point,
        element,
        userId,
      }: {
        point?: Point;
        element?: ElementData;
        userId: string;
      }) => {
        if (element) {
          setLiveDrawings((prev) => ({ ...prev, [userId]: element }));
        } else if (point) {
          setLiveDrawings((prev) => ({
            ...prev,
            [userId]: {
              id: generateId("pen"),
              type: (point.tool || "pen") as ShapeType,
              points: [point],
              color: point.color || "#000000",
              lineWidth: point.lineWidth || 2,
            },
          }));
        }
      }
    );

    socket.on(
      "drawProgress",
      ({
        point,
        element,
        userId,
      }: {
        point?: Point;
        element?: ElementData;
        userId: string;
      }) => {
        if (element) {
          setLiveDrawings((prev) => ({ ...prev, [userId]: element }));
        } else if (point) {
          setLiveDrawings((prev) => {
            const existing = prev[userId]?.points || [];
            return {
              ...prev,
              [userId]: {
                id: prev[userId]?.id || generateId("pen"),
                type: (point.tool || prev[userId]?.type || "pen") as ShapeType,
                points: [...existing, point],
                color: point.color || prev[userId]?.color || "#000000",
                lineWidth: point.lineWidth || prev[userId]?.lineWidth || 2,
              },
            };
          });
        }
      }
    );

    socket.on(
      "drawEnd",
      ({ userId }: { line?: ElementData; userId?: string }) => {
        if (userId) {
          setLiveDrawings((prev) => {
            if (!prev[userId]) return prev;
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      }
    );

    socket.on(
      "element:create",
      ({ userId }: { element?: ElementData; userId?: string }) => {
        if (userId) {
          setLiveDrawings((prev) => {
            if (!prev[userId]) return prev;
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      }
    );

    socket.on(
      "shapeMove",
      ({ id, x, y }: { id: string; x: number; y: number; userId?: string }) => {
        setLines((prev) =>
          prev.map((el) => {
            if (el.id === id) {
              return { ...el, x, y };
            }
            return el;
          })
        );
      }
    );

    socket.on(
      "updateElements",
      ({ lines: updatedLines }: { lines?: ElementData[] }) => {
        if (updatedLines) {
          setLines(updatedLines);
        }
      }
    );

    socket.on("clearBoard", () => {
      setLiveDrawings({});
      setCurrentShape(null);
      setCurrentLine([]);
      setSelectedId(null);
      setSelectedBox(null);
    });

    socket.on("userLeft", (updatedUsers: { id: string; name: string }[]) => {
      const activeIds = new Set(updatedUsers.map((u) => u.id));
      setCursors((prev) => prev.filter((c) => activeIds.has(c.id)));
      setLiveDrawings((prev) => {
        const next: Record<string, ElementData> = {};
        for (const id in prev) {
          if (activeIds.has(id)) next[id] = prev[id];
        }
        return next;
      });
    });

    return () => {
      socket.off("mouseUpdate");
      socket.off("drawStart");
      socket.off("drawProgress");
      socket.off("drawEnd");
      socket.off("element:create");
      socket.off("shapeMove");
      socket.off("updateElements");
      socket.off("clearBoard");
      socket.off("userLeft");
    };
  }, [socket, setLines]);

  // Selected shape quick actions
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const idToDelete = selectedId;
    setSelectedId(null);
    setSelectedBox(null);
    setLines((prev) => prev.filter((el) => el.id !== idToDelete));
    if (socket) {
      emitWithAck(socket, "element:delete", { roomId, id: idToDelete })
        .then((ack) => {
          if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
        })
        .catch(console.error);
    }
  }, [selectedId, roomId, socket, setLines, onVersionUpdate]);

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    const target = lines.find((el) => el.id === selectedId);
    if (!target) return;
    const newId = generateId(target.type || "shape");
    const clone: ElementData = {
      ...target,
      id: newId,
      userId: socket?.id,
      x: (target.x || 0) + 24,
      y: (target.y || 0) + 24,
      createdAt: Date.now(),
    };
    setLines((prev) => [...prev, clone]);
    onElementCreated?.(clone);
    setSelectedId(newId);
    if (socket) {
      emitWithAck(socket, "element:create", { roomId, element: clone })
        .then((ack) => {
          if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
        })
        .catch(console.error);
    }
    setTimeout(updateSelectedBox, 50);
  }, [selectedId, lines, roomId, socket, setLines, updateSelectedBox, onElementCreated, onVersionUpdate]);

  const bringToFront = useCallback(() => {
    if (!selectedId) return;
    const idx = lines.findIndex((el) => el.id === selectedId);
    if (idx === -1 || idx === lines.length - 1) return;
    const item = lines[idx];
    const updated = [...lines.slice(0, idx), ...lines.slice(idx + 1), item];
    setLines(updated);
    if (socket) {
      emitWithAck(socket, "element:reorder", {
        roomId,
        id: selectedId,
        to: "front",
      })
        .then((ack) => {
          if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
        })
        .catch(console.error);
    }
  }, [selectedId, lines, roomId, socket, setLines, onVersionUpdate]);

  const sendToBack = useCallback(() => {
    if (!selectedId) return;
    const idx = lines.findIndex((el) => el.id === selectedId);
    if (idx === -1 || idx === 0) return;
    const item = lines[idx];
    const updated = [item, ...lines.slice(0, idx), ...lines.slice(idx + 1)];
    setLines(updated);
    if (socket) {
      emitWithAck(socket, "element:reorder", {
        roomId,
        id: selectedId,
        to: "back",
      })
        .then((ack) => {
          if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
        })
        .catch(console.error);
    }
  }, [selectedId, lines, roomId, socket, setLines, onVersionUpdate]);

  const changeSelectedColor = useCallback(
    (newColor: string) => {
      if (!selectedId) return;
      setLines((prev) =>
        prev.map((el) =>
          el.id === selectedId ? { ...el, color: newColor } : el
        )
      );
      if (socket) {
        emitWithAck(socket, "element:update", {
          roomId,
          id: selectedId,
          patch: { color: newColor },
        })
          .then((ack) => {
            if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
          })
          .catch(console.error);
      }
    },
    [selectedId, roomId, socket, setLines, onVersionUpdate]
  );

  const changeSelectedLineWidth = useCallback(
    (newWidth: number) => {
      if (!selectedId) return;
      setLines((prev) =>
        prev.map((el) =>
          el.id === selectedId ? { ...el, lineWidth: newWidth } : el
        )
      );
      if (socket) {
        emitWithAck(socket, "element:update", {
          roomId,
          id: selectedId,
          patch: { lineWidth: newWidth },
        })
          .then((ack) => {
            if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
          })
          .catch(console.error);
      }
    },
    [selectedId, roomId, socket, setLines, onVersionUpdate]
  );

  // Keyboard controls for selected shape (Delete, Esc, arrows to nudge, Ctrl+D to duplicate)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (tool === "select" && selectedId) {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          deleteSelected();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setSelectedId(null);
          setSelectedBox(null);
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
          e.preventDefault();
          duplicateSelected();
        } else if (
          e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight"
        ) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 2;
          const dx =
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy =
            e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          setLines((prev) =>
            prev.map((el) => {
              if (el.id === selectedId) {
                const nextX = (el.x || 0) + dx;
                const nextY = (el.y || 0) + dy;
                if (socket) {
                  emitWithAck(socket, "element:update", {
                    roomId,
                    id: selectedId,
                    patch: { x: nextX, y: nextY },
                  })
                    .then((ack) => {
                      if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
                    })
                    .catch(console.error);
                }
                return {
                  ...el,
                  x: nextX,
                  y: nextY,
                };
              }
              return el;
            })
          );
          setTimeout(updateSelectedBox, 10);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    tool,
    selectedId,
    deleteSelected,
    duplicateSelected,
    roomId,
    socket,
    setLines,
    updateSelectedBox,
    onVersionUpdate,
  ]);

  const handlePointerDown = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const stage = e.target.getStage();
    if (!stage) return;

    // Pan handling: middle-click, hand tool, holding Spacebar, or dragging empty canvas background in select mode
    const isMiddleClick = "button" in e.evt && (e.evt as MouseEvent).button === 1;
    const isStageBackground = e.target === stage || e.target.getClassName() === "Image";
    const shouldPan =
      isMiddleClick ||
      tool === "hand" ||
      isSpacePressed.current ||
      (tool === "select" && isStageBackground);

    if (shouldPan) {
      isPanning.current = true;
      const clientX = "clientX" in e.evt ? e.evt.clientX : e.evt.touches[0].clientX;
      const clientY = "clientY" in e.evt ? e.evt.clientY : e.evt.touches[0].clientY;
      panStart.current = {
        x: clientX - stagePos.x,
        y: clientY - stagePos.y,
      };
      stage.container().style.cursor = "grabbing";
      if (tool === "select" && isStageBackground) {
        setSelectedId(null);
        setSelectedBox(null);
      }
      return;
    }

    const pos = getWorldPointer();
    if (!pos) return;

    // Text tool click: place text input
    if (tool === "text") {
      setTextInput({
        visible: true,
        x: pos.x,
        y: pos.y,
        text: "",
      });
      return;
    }

    if (tool === "select") {
      if (isStageBackground) {
        setSelectedId(null);
        setSelectedBox(null);
      }
      return;
    }

    isDrawing.current = true;
    startPos.current = { x: pos.x, y: pos.y };

    const elementId = generateId(tool);
    activeElementId.current = elementId;

    if (tool === "pen" || tool === "brush" || tool === "eraser") {
      const initialPoint: Point = {
        ...pos,
        tool,
        color: tool === "eraser" ? "#ffffff" : color,
        lineWidth: tool === "brush" ? lineWidth * 2 : lineWidth,
      };
      setCurrentLine([initialPoint]);
      currentLineRef.current = [initialPoint];
      socket?.emit("drawStart", {
        roomId,
        point: initialPoint,
        element: {
          id: elementId,
          userId: socket?.id,
          type: tool as ShapeType,
          points: [initialPoint],
          color: tool === "eraser" ? "#ffffff" : color,
          lineWidth: tool === "brush" ? lineWidth * 2 : lineWidth,
        },
      });
    } else if (
      tool === "rectangle" ||
      tool === "circle" ||
      tool === "line" ||
      tool === "arrow"
    ) {
      const initialShape: ElementData = {
        id: elementId,
        userId: socket?.id,
        type: tool as ShapeType,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        radius: 0,
        points: [pos, pos],
        color,
        lineWidth,
        createdAt: Date.now(),
      };
      setCurrentShape(initialShape);
      socket?.emit("drawStart", { roomId, element: initialShape });
    }
  };

  const handlePointerMove = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    if (isPanning.current) {
      const clientX = "clientX" in e.evt ? e.evt.clientX : e.evt.touches[0].clientX;
      const clientY = "clientY" in e.evt ? e.evt.clientY : e.evt.touches[0].clientY;
      setStagePos({
        x: Math.round(clientX - panStart.current.x),
        y: Math.round(clientY - panStart.current.y),
      });
      return;
    }

    const pos = getWorldPointer();
    if (!pos) return;

    if (socket) {
      throttledMouseMove(socket, roomId, pos.x, pos.y);
    }

    if (!isDrawing.current) return;

    if (tool === "pen" || tool === "brush" || tool === "eraser") {
      const newPoint: Point = {
        ...pos,
        tool,
        color: tool === "eraser" ? "#ffffff" : color,
        lineWidth: tool === "brush" ? lineWidth * 2 : lineWidth,
      };
      const updatedLine = [...currentLineRef.current, newPoint];
      currentLineRef.current = updatedLine;
      setCurrentLine(updatedLine);

      if (socket) {
        throttledDrawProgress(socket, {
          roomId,
          point: newPoint,
          element: {
            id: activeElementId.current || undefined,
            userId: socket.id,
            type: tool as ShapeType,
            points: updatedLine,
            color: tool === "eraser" ? "#ffffff" : color,
            lineWidth: tool === "brush" ? lineWidth * 2 : lineWidth,
          },
        });
      }
    } else if (tool === "rectangle") {
      const x = Math.min(startPos.current.x, pos.x);
      const y = Math.min(startPos.current.y, pos.y);
      const width = Math.abs(pos.x - startPos.current.x);
      const height = Math.abs(pos.y - startPos.current.y);
      const preview: ElementData = {
        id: activeElementId.current || undefined,
        userId: socket?.id,
        type: "rectangle",
        x,
        y,
        width,
        height,
        color,
        lineWidth,
      };
      setCurrentShape(preview);
      if (socket) {
        throttledDrawProgress(socket, { roomId, element: preview });
      }
    } else if (tool === "circle") {
      const radius = Math.sqrt(
        (pos.x - startPos.current.x) ** 2 + (pos.y - startPos.current.y) ** 2
      );
      const preview: ElementData = {
        id: activeElementId.current || undefined,
        userId: socket?.id,
        type: "circle",
        x: startPos.current.x,
        y: startPos.current.y,
        radius,
        color,
        lineWidth,
      };
      setCurrentShape(preview);
      if (socket) {
        throttledDrawProgress(socket, { roomId, element: preview });
      }
    } else if (tool === "line" || tool === "arrow") {
      const preview: ElementData = {
        id: activeElementId.current || undefined,
        userId: socket?.id,
        type: tool as ShapeType,
        points: [startPos.current, pos],
        x: 0,
        y: 0,
        color,
        lineWidth,
      };
      setCurrentShape(preview);
      if (socket) {
        throttledDrawProgress(socket, { roomId, element: preview });
      }
    }
  };

  const handlePointerUp = () => {
    if (isPanning.current) {
      isPanning.current = false;
      const stage = stageRef.current;
      if (stage) {
        stage.container().style.cursor =
          isSpacePressed.current || tool === "hand"
            ? "grab"
            : tool === "select"
            ? "default"
            : "crosshair";
      }
      return;
    }

    if (!isDrawing.current) return;

    throttledDrawProgress.cancel();

    if (tool === "pen" || tool === "brush" || tool === "eraser") {
      const strokePoints =
        currentLineRef.current.length > 0
          ? currentLineRef.current
          : currentLine;
      if (strokePoints.length > 0) {
        const newLine: ElementData = {
          id: activeElementId.current || generateId(tool),
          userId: socket?.id,
          type: tool as ShapeType,
          points: strokePoints,
          x: 0,
          y: 0,
          color: tool === "eraser" ? "#ffffff" : color,
          lineWidth: tool === "brush" ? lineWidth * 2 : lineWidth,
          createdAt: Date.now(),
        };
        setLines((prev) => [...prev, newLine]);
        onElementCreated?.(newLine);
        if (socket) {
          emitWithAck(socket, "element:create", {
            roomId,
            element: newLine,
          })
            .then((ack) => {
              if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
            })
            .catch(console.error);
        }
        setCurrentLine([]);
        currentLineRef.current = [];
      }
    } else if (currentShape) {
      const finalShape: ElementData = {
        ...currentShape,
        id: currentShape.id || activeElementId.current || generateId(tool),
        userId: socket?.id,
        x: currentShape.x || 0,
        y: currentShape.y || 0,
        createdAt: Date.now(),
      };
      setLines((prev) => [...prev, finalShape]);
      onElementCreated?.(finalShape);
      if (socket) {
        emitWithAck(socket, "element:create", {
          roomId,
          element: finalShape,
        })
          .then((ack) => {
            if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
          })
          .catch(console.error);
      }
      setCurrentShape(null);
    }

    activeElementId.current = null;
    isDrawing.current = false;
  };

  const commitText = () => {
    if (textInput && textInput.text.trim()) {
      if (textInput.editingId) {
        // Updating existing text
        const patch = { text: textInput.text.trim() };
        setLines((prev) =>
          prev.map((el) => (el.id === textInput.editingId ? { ...el, ...patch } : el))
        );
        if (socket) {
          emitWithAck(socket, "element:update", {
            roomId,
            id: textInput.editingId,
            patch,
          })
            .then((ack) => {
              if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
            })
            .catch(console.error);
        }
      } else {
        // Creating new text
        const textElement: ElementData = {
          id: generateId("text"),
          userId: socket?.id,
          type: "text",
          x: textInput.x,
          y: textInput.y,
          text: textInput.text.trim(),
          fontSize: Math.max(16, lineWidth * 4),
          color,
          lineWidth: 1,
          createdAt: Date.now(),
        };
        setLines((prev) => [...prev, textElement]);
        onElementCreated?.(textElement);
        if (socket) {
          emitWithAck(socket, "element:create", {
            roomId,
            element: textElement,
          })
            .then((ack) => {
              if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
            })
            .catch(console.error);
        }
      }
    }
    setTextInput(null);
  };

  // Helper to flatten points array safely
  const getFlatPoints = (pts?: Point[] | number[]): number[] => {
    if (!pts || pts.length === 0) return [];
    if (typeof pts[0] === "number") return pts as number[];
    return (pts as Point[]).flatMap((p) => [p.x, p.y]);
  };

  // Shape drag & transform handlers
  const handleShapeDragStart =
    (id: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
      if (tool === "select") {
        e.cancelBubble = true;
        setSelectedId(id);
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "grabbing";
      }
    };

  const handleShapeDragMove =
    (id: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
      if (tool === "select") {
        const node = e.target;
        if (socket) {
          throttledShapeMove(
            socket,
            roomId,
            id,
            Math.round(node.x()),
            Math.round(node.y())
          );
        }
        updateSelectedBox();
      }
    };

  const handleShapeDragEnd =
    (id: string) => (e: Konva.KonvaEventObject<DragEvent>) => {
      if (tool === "select") {
        throttledShapeMove.cancel();
        const node = e.target;
        const newX = Math.round(node.x());
        const newY = Math.round(node.y());
        const stage = node.getStage();
        if (stage) stage.container().style.cursor = "move";

        setLines((prev) =>
          prev.map((el) => {
            if (el.id === id) {
              return {
                ...el,
                x: newX,
                y: newY,
              };
            }
            return el;
          })
        );

        if (socket) {
          emitWithAck(socket, "element:update", {
            roomId,
            id,
            patch: { x: newX, y: newY },
          })
            .then((ack) => {
              if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
            })
            .catch(console.error);
        }

        setTimeout(updateSelectedBox, 20);
      }
    };

  const handleTransformEnd = () => {
    if (!trRef.current) return;
    const nodes = trRef.current.nodes();
    if (nodes.length === 0) return;
    const node = nodes[0];
    const id = node.id();

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const rotation = Math.round(node.rotation());

    // Reset scales on the Konva node so subsequent renders don't compound scales
    node.scaleX(1);
    node.scaleY(1);

    const patch: Partial<ElementData> = {
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      rotation,
    };

    setLines((prev) => {
      const updated = prev.map((el) => {
        if (el.id !== id) return el;

        const newEl: ElementData = {
          ...el,
          ...patch,
        };

        if (el.type === "rectangle" || el.type === "image") {
          newEl.width = Math.max(
            15,
            Math.round((el.width || 100) * Math.abs(scaleX))
          );
          newEl.height = Math.max(
            15,
            Math.round((el.height || 100) * Math.abs(scaleY))
          );
          patch.width = newEl.width;
          patch.height = newEl.height;
        } else if (el.type === "circle") {
          newEl.radius = Math.max(
            5,
            Math.round(
              (el.radius || 0) * Math.max(Math.abs(scaleX), Math.abs(scaleY))
            )
          );
          patch.radius = newEl.radius;
        } else if (el.type === "text") {
          const fontScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
          newEl.fontSize = Math.max(
            10,
            Math.round((el.fontSize || 20) * fontScale)
          );
          patch.fontSize = newEl.fontSize;
        }

        return newEl;
      });

      if (socket) {
        emitWithAck(socket, "element:update", {
          roomId,
          id,
          patch,
        })
          .then((ack) => {
            if (typeof ack?.version === "number") onVersionUpdate?.(ack.version);
          })
          .catch(console.error);
      }

      return updated;
    });

    setTimeout(updateSelectedBox, 50);
  };

  const handleShapeMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "select") {
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = "move";
    }
  };

  const handleShapeMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "select") {
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = "default";
    }
  };

  const handleShapeClick =
    (id: string) => (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (tool === "select") {
        e.cancelBubble = true;
        setSelectedId(id);
      }
    };

  const handleShapeDblClick = (id: string) => () => {
    if (tool === "select") {
      const target = lines.find((item) => item.id === id);
      if (target && target.type === "text") {
        setTextInput({
          visible: true,
          x: target.x || 0,
          y: target.y || 0,
          text: target.text || "",
          editingId: target.id,
        });
      }
    }
  };

  // Render individual whiteboard element
  const renderElement = (
    el: ElementData,
    key: string | number,
    isFinalized: boolean = true
  ) => {
    if (!el) return null;
    const elementId = el.id || `el_${key}`;
    const isDraggable = isFinalized && tool === "select";

    // Image element (selectable, draggable, resizable)
    if (el.type === "image" && el.src) {
      return (
        <CanvasImageItem
          key={key}
          id={elementId}
          el={el}
          isDraggable={isDraggable}
          onMouseEnter={isDraggable ? handleShapeMouseEnter : undefined}
          onMouseLeave={isDraggable ? handleShapeMouseLeave : undefined}
          onClick={isDraggable ? handleShapeClick(elementId) : undefined}
          onTap={isDraggable ? handleShapeClick(elementId) : undefined}
          onDragStart={isDraggable ? handleShapeDragStart(elementId) : undefined}
          onDragMove={isDraggable ? handleShapeDragMove(elementId) : undefined}
          onDragEnd={isDraggable ? handleShapeDragEnd(elementId) : undefined}
        />
      );
    }

    // Text element (selectable, draggable, resizable, double-clickable)
    if (el.type === "text" && el.text) {
      return (
        <KonvaText
          key={key}
          id={elementId}
          x={el.x || 0}
          y={el.y || 0}
          rotation={el.rotation || 0}
          text={el.text}
          fontSize={el.fontSize || 20}
          fill={el.color || "#000000"}
          fontFamily="system-ui, sans-serif"
          fontStyle="bold"
          hitStrokeWidth={12}
          draggable={isDraggable}
          onMouseEnter={isDraggable ? handleShapeMouseEnter : undefined}
          onMouseLeave={isDraggable ? handleShapeMouseLeave : undefined}
          onClick={isDraggable ? handleShapeClick(elementId) : undefined}
          onTap={isDraggable ? handleShapeClick(elementId) : undefined}
          onDblClick={isDraggable ? handleShapeDblClick(elementId) : undefined}
          onDblTap={isDraggable ? handleShapeDblClick(elementId) : undefined}
          onDragStart={isDraggable ? handleShapeDragStart(elementId) : undefined}
          onDragMove={isDraggable ? handleShapeDragMove(elementId) : undefined}
          onDragEnd={isDraggable ? handleShapeDragEnd(elementId) : undefined}
        />
      );
    }

    if (
      el.type === "rectangle" &&
      el.width !== undefined &&
      el.height !== undefined
    ) {
      return (
        <Rect
          key={key}
          id={elementId}
          x={el.x || 0}
          y={el.y || 0}
          width={el.width}
          height={el.height}
          rotation={el.rotation || 0}
          stroke={el.color || "#000000"}
          strokeWidth={el.lineWidth || 2}
          hitStrokeWidth={Math.max(16, el.lineWidth || 2)}
          cornerRadius={4}
          fill={el.fill || "transparent"}
          draggable={isDraggable}
          onMouseEnter={isDraggable ? handleShapeMouseEnter : undefined}
          onMouseLeave={isDraggable ? handleShapeMouseLeave : undefined}
          onClick={isDraggable ? handleShapeClick(elementId) : undefined}
          onTap={isDraggable ? handleShapeClick(elementId) : undefined}
          onDragStart={isDraggable ? handleShapeDragStart(elementId) : undefined}
          onDragMove={isDraggable ? handleShapeDragMove(elementId) : undefined}
          onDragEnd={isDraggable ? handleShapeDragEnd(elementId) : undefined}
        />
      );
    }

    if (el.type === "circle" && el.radius !== undefined) {
      return (
        <KonvaCircle
          key={key}
          id={elementId}
          x={el.x || 0}
          y={el.y || 0}
          radius={Math.max(1, el.radius)}
          rotation={el.rotation || 0}
          stroke={el.color || "#000000"}
          strokeWidth={el.lineWidth || 2}
          hitStrokeWidth={Math.max(16, el.lineWidth || 2)}
          fill={el.fill || "transparent"}
          draggable={isDraggable}
          onMouseEnter={isDraggable ? handleShapeMouseEnter : undefined}
          onMouseLeave={isDraggable ? handleShapeMouseLeave : undefined}
          onClick={isDraggable ? handleShapeClick(elementId) : undefined}
          onTap={isDraggable ? handleShapeClick(elementId) : undefined}
          onDragStart={isDraggable ? handleShapeDragStart(elementId) : undefined}
          onDragMove={isDraggable ? handleShapeDragMove(elementId) : undefined}
          onDragEnd={isDraggable ? handleShapeDragEnd(elementId) : undefined}
        />
      );
    }

    if (el.type === "line" && el.points && el.points.length >= 2) {
      return (
        <Line
          key={key}
          id={elementId}
          x={el.x || 0}
          y={el.y || 0}
          rotation={el.rotation || 0}
          points={getFlatPoints(el.points)}
          stroke={el.color || "#000000"}
          strokeWidth={el.lineWidth || 2}
          hitStrokeWidth={Math.max(20, (el.lineWidth || 2) * 2)}
          lineCap="round"
          draggable={isDraggable}
          onMouseEnter={isDraggable ? handleShapeMouseEnter : undefined}
          onMouseLeave={isDraggable ? handleShapeMouseLeave : undefined}
          onClick={isDraggable ? handleShapeClick(elementId) : undefined}
          onTap={isDraggable ? handleShapeClick(elementId) : undefined}
          onDragStart={isDraggable ? handleShapeDragStart(elementId) : undefined}
          onDragMove={isDraggable ? handleShapeDragMove(elementId) : undefined}
          onDragEnd={isDraggable ? handleShapeDragEnd(elementId) : undefined}
        />
      );
    }

    if (el.type === "arrow" && el.points && el.points.length >= 2) {
      return (
        <Arrow
          key={key}
          id={elementId}
          x={el.x || 0}
          y={el.y || 0}
          rotation={el.rotation || 0}
          points={getFlatPoints(el.points)}
          pointerLength={10}
          pointerWidth={10}
          fill={el.color || "#000000"}
          stroke={el.color || "#000000"}
          strokeWidth={el.lineWidth || 2}
          hitStrokeWidth={Math.max(20, (el.lineWidth || 2) * 2)}
          lineCap="round"
          draggable={isDraggable}
          onMouseEnter={isDraggable ? handleShapeMouseEnter : undefined}
          onMouseLeave={isDraggable ? handleShapeMouseLeave : undefined}
          onClick={isDraggable ? handleShapeClick(elementId) : undefined}
          onTap={isDraggable ? handleShapeClick(elementId) : undefined}
          onDragStart={isDraggable ? handleShapeDragStart(elementId) : undefined}
          onDragMove={isDraggable ? handleShapeDragMove(elementId) : undefined}
          onDragEnd={isDraggable ? handleShapeDragEnd(elementId) : undefined}
        />
      );
    }

    if (el.points && el.points.length > 0) {
      const isEraser =
        el.points[0]?.tool === "eraser" || el.type === "eraser";
      return (
        <Line
          key={key}
          id={elementId}
          x={el.x || 0}
          y={el.y || 0}
          rotation={el.rotation || 0}
          points={getFlatPoints(el.points)}
          stroke={el.points[0]?.color || el.color || "#000000"}
          strokeWidth={el.points[0]?.lineWidth || el.lineWidth || 5}
          hitStrokeWidth={Math.max(
            20,
            el.points[0]?.lineWidth || el.lineWidth || 5
          )}
          lineCap="round"
          lineJoin="round"
          tension={0.5}
          globalCompositeOperation={
            isEraser ? "destination-out" : "source-over"
          }
          draggable={isDraggable}
          onMouseEnter={isDraggable ? handleShapeMouseEnter : undefined}
          onMouseLeave={isDraggable ? handleShapeMouseLeave : undefined}
          onClick={isDraggable ? handleShapeClick(elementId) : undefined}
          onTap={isDraggable ? handleShapeClick(elementId) : undefined}
          onDragStart={isDraggable ? handleShapeDragStart(elementId) : undefined}
          onDragMove={isDraggable ? handleShapeDragMove(elementId) : undefined}
          onDragEnd={isDraggable ? handleShapeDragEnd(elementId) : undefined}
        />
      );
    }

    return null;
  };

  const selectedElement = lines.find((el) => el.id === selectedId);

  // Position for the floating shape toolbar
  const toolbarX = selectedBox
    ? Math.max(
        12,
        Math.min(
          dimensions.width - 320,
          selectedBox.x + selectedBox.width / 2 - 140
        )
      )
    : 0;
  const toolbarY = selectedBox
    ? selectedBox.y > 60
      ? selectedBox.y - 52
      : selectedBox.y + selectedBox.height + 16
    : 0;

  // Screen coordinates for floating text editor when placing/editing text
  const textInputScreenX = textInput
    ? textInput.x * stageScale + stagePos.x
    : 0;
  const textInputScreenY = textInput
    ? textInput.y * stageScale + stagePos.y
    : 0;

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={handleWheel}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        ref={stageRef}
        className={
          isSpaceActive || tool === "hand"
            ? "cursor-grab"
            : tool === "select"
            ? "cursor-default"
            : "cursor-crosshair"
        }
      >
        <Layer>
          {loadedImage && (
            <KonvaImage
              image={loadedImage}
              x={0}
              y={0}
              width={
                loadedImage.width > dimensions.width
                  ? dimensions.width
                  : loadedImage.width
              }
              height={
                loadedImage.width > dimensions.width
                  ? (loadedImage.height * dimensions.width) / loadedImage.width
                  : loadedImage.height
              }
            />
          )}

          {/* Render finalized elements/lines (selectable & draggable when tool === 'select') */}
          {lines.map((el, i) => renderElement(el, el.id || i, true))}

          {/* Render in-progress shapes/drawings from other participants */}
          {Object.entries(liveDrawings).map(([uid, el]) =>
            renderElement(el, `live-${uid}`, false)
          )}

          {/* Render local in-progress freehand stroke */}
          {currentLine.length > 0 && (
            <Line
              points={currentLine.flatMap((p) => [p.x, p.y])}
              stroke={currentLine[0]?.color || color}
              strokeWidth={currentLine[0]?.lineWidth || lineWidth}
              lineCap="round"
              lineJoin="round"
              tension={0.5}
              globalCompositeOperation={
                currentLine[0]?.tool === "eraser"
                  ? "destination-out"
                  : "source-over"
              }
            />
          )}

          {/* Render local in-progress shape (rect, circle, arrow, line) */}
          {currentShape &&
            renderElement(currentShape, "local-shape-preview", false)}

          {/* Transformer for selected shape in 'select' mode */}
          {tool === "select" && selectedId && (
            <Transformer
              ref={trRef}
              boundBoxFunc={(oldBox, newBox) => {
                if (
                  Math.abs(newBox.width) < 10 ||
                  Math.abs(newBox.height) < 10
                ) {
                  return oldBox;
                }
                return newBox;
              }}
              rotateEnabled={true}
              anchorCornerRadius={3}
              anchorSize={8}
              anchorStroke="#2563eb"
              anchorFill="#ffffff"
              anchorStrokeWidth={1.5}
              borderStroke="#3b82f6"
              borderStrokeWidth={1.5}
              borderDash={[4, 4]}
              onTransformEnd={handleTransformEnd}
            />
          )}

          {/* Remote User Cursors with individual colors and name badge */}
          {cursors.map((cursor) => {
            const userColor = cursor.color || getUserColor(cursor.id);
            return (
              <Group key={cursor.id} x={cursor.x} y={cursor.y}>
                {/* Pointer cursor arrow */}
                <Path
                  data="M 0 0 L 0 15 L 4 11 L 7 18 L 10 16 L 7 10 L 12 10 Z"
                  fill={userColor}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
                {/* Floating name badge */}
                <Rect
                  x={12}
                  y={10}
                  width={Math.max(36, cursor.name.length * 8 + 12)}
                  height={18}
                  fill={userColor}
                  cornerRadius={4}
                />
                <KonvaText
                  x={18}
                  y={13}
                  text={cursor.name}
                  fill="#ffffff"
                  fontSize={10}
                  fontStyle="bold"
                  fontFamily="system-ui, sans-serif"
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>

      {/* Floating Action Toolbar for selected shape / image / text */}
      {tool === "select" && selectedId && selectedBox && (
        <div
          className="absolute z-40 flex items-center gap-1.5 px-3 py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-xl border border-gray-200/90 dark:border-gray-700/90 transition-all text-xs"
          style={{
            left: `${toolbarX}px`,
            top: `${toolbarY}px`,
          }}
        >
          {/* Shape type badge */}
          <span className="font-semibold text-gray-500 dark:text-gray-400 capitalize pr-1 border-r border-gray-200 dark:border-gray-700">
            {selectedElement?.type || "Shape"}
          </span>

          {/* Color changer (for vectors and text, not image) */}
          {selectedElement?.type !== "image" && (
            <div className="flex items-center gap-1">
              {PRESET_PALETTE.slice(0, 4).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => changeSelectedColor(c)}
                  title={`Change color to ${c}`}
                  className={`w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 transition-transform hover:scale-110 ${
                    selectedElement?.color === c
                      ? "ring-2 ring-blue-500 scale-110"
                      : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label
                title="Custom color for shape"
                className="w-4 h-4 rounded-full cursor-pointer overflow-hidden border border-gray-300 dark:border-gray-600 hover:scale-110 transition-transform relative"
                style={{
                  background:
                    "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                }}
              >
                <input
                  type="color"
                  value={selectedElement?.color || "#000000"}
                  onChange={(e) => changeSelectedColor(e.target.value)}
                  className="opacity-0 absolute inset-0 cursor-pointer w-full h-full"
                />
              </label>
            </div>
          )}

          {selectedElement?.type !== "image" && selectedElement?.type !== "text" && (
            <>
              <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />
              {/* Stroke Width changer */}
              <div className="flex items-center gap-0.5">
                {[2, 5, 10].map((w, idx) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => changeSelectedLineWidth(w)}
                    className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${
                      selectedElement?.lineWidth === w
                        ? "bg-blue-600 text-white"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {["S", "M", "L"][idx]}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />

          {/* Layer order (Bring Forward / Send Backward) */}
          <button
            type="button"
            onClick={bringToFront}
            title="Bring to Front"
            className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ChevronsUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={sendToBack}
            title="Send to Back"
            className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ChevronsDown className="w-3.5 h-3.5" />
          </button>

          {/* Duplicate */}
          <button
            type="button"
            onClick={duplicateSelected}
            title="Duplicate (Ctrl+D)"
            className="p-1 rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={deleteSelected}
            title="Delete shape (Del)"
            className="p-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Deselect */}
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setSelectedBox(null);
            }}
            title="Deselect (Esc)"
            className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating text editor when text tool is used or text is double-clicked */}
      {textInput && textInput.visible && (
        <div
          className="absolute z-50 flex items-center gap-1 bg-white dark:bg-gray-800 p-2 rounded-lg shadow-xl border border-gray-300 dark:border-gray-600"
          style={{
            left: `${Math.min(textInputScreenX, dimensions.width - 240)}px`,
            top: `${Math.min(textInputScreenY, dimensions.height - 80)}px`,
          }}
        >
          <input
            type="text"
            autoFocus
            placeholder="Type text and press Enter..."
            value={textInput.text}
            onChange={(e) =>
              setTextInput({ ...textInput, text: e.target.value })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitText();
              } else if (e.key === "Escape") {
                setTextInput(null);
              }
            }}
            className="px-2 py-1 text-sm bg-transparent border-b border-blue-500 focus:outline-none dark:text-white"
            style={{ color, minWidth: "180px" }}
          />
          <button
            onClick={commitText}
            className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
          >
            {textInput.editingId ? "Save" : "Add"}
          </button>
          <button
            onClick={() => setTextInput(null)}
            className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            ✕
          </button>
        </div>
      )}

      {/* Zoom / Pan Navigation HUD */}
      <div className="absolute bottom-6 right-6 z-40 flex items-center gap-1.5 px-3 py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-lg border border-gray-200/90 dark:border-gray-700/90 text-xs font-medium text-gray-700 dark:text-gray-200">
        <button
          type="button"
          onClick={() => {
            setStageScale((prev) => Math.max(0.02, prev / 1.25));
          }}
          title="Zoom Out"
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setStageScale(1);
            setStagePos({ x: 0, y: 0 });
          }}
          title="Reset View (100%)"
          className="px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors font-mono font-bold"
        >
          {Math.round(stageScale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => {
            setStageScale((prev) => Math.min(50, prev * 1.25));
          }}
          title="Zoom In"
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default WhiteboardCanvas;
