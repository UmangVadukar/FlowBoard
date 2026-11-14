import React, { useState, useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import WhiteboardCanvas from "./Whiteboard";
import Toolbar from "./Toolbar";
import "bootstrap/dist/css/bootstrap.min.css";
import { LineData, RoomOperation, generateId } from "@/types/types";
import { emitWithAck } from "@/utils/socketUtils";
import Konva from "konva";

interface MainProps {
  roomId: string;
  socket: Socket | null;
}

function applyOperationToLines(prev: LineData[], op: RoomOperation): LineData[] {
  switch (op.type) {
    case "element:create": {
      if (!op.element || !op.element.id) return prev;
      if (prev.some((e) => e.id === op.element?.id)) return prev;
      return [...prev, op.element];
    }
    case "element:update": {
      if (!op.id || !op.patch) return prev;
      return prev.map((e) => (e.id === op.id ? { ...e, ...op.patch } : e));
    }
    case "element:delete": {
      if (!op.id) return prev;
      return prev.filter((e) => e.id !== op.id);
    }
    case "element:reorder": {
      if (!op.id || !op.to) return prev;
      const idx = prev.findIndex((e) => e.id === op.id);
      if (idx === -1) return prev;
      const item = prev[idx];
      const without = prev.filter((e) => e.id !== op.id);
      return op.to === "front" ? [...without, item] : [item, ...without];
    }
    case "clearBoard": {
      return [];
    }
    default:
      return prev;
  }
}

const Main: React.FC<MainProps> = ({ roomId, socket }) => {
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#000000");
  const [lineWidth, setLineWidth] = useState(5);
  const [lines, setLines] = useState<LineData[]>([]);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  // Room sequence / version tracking
  const roomVersionRef = useRef<number>(0);

  // Track elements created by this user for operation-based undo
  const myCreatedIds = useRef<string[]>([]);

  const onElementCreated = useCallback((element: LineData) => {
    if (element?.id) {
      myCreatedIds.current.push(element.id);
    }
  }, []);

  const onVersionUpdate = useCallback((version: number) => {
    if (typeof version === "number" && version > roomVersionRef.current) {
      roomVersionRef.current = version;
    }
  }, []);

  // Synchronize version & detect sequence gaps
  const handleIncomingVersion = useCallback(
    (version?: number) => {
      if (typeof version !== "number") return;
      const current = roomVersionRef.current;
      if (version > current + 1) {
        // Gap detected! Request catch-up or snapshot from server
        socket?.emit(
          "syncRoom",
          { roomId, lastVersion: current },
          (response: {
            success: boolean;
            mode?: string;
            operations?: RoomOperation[];
            toVersion?: number;
            lines?: LineData[];
            image?: string | null;
            version?: number;
          }) => {
            if (response && response.success) {
              if (response.mode === "delta" && Array.isArray(response.operations)) {
                setLines((prev) => {
                  let updated = [...prev];
                  for (const op of response.operations || []) {
                    updated = applyOperationToLines(updated, op);
                    if (op.type === "addImage") {
                      setImageSrc(op.image || null);
                    }
                  }
                  return updated;
                });
                if (typeof response.toVersion === "number") {
                  roomVersionRef.current = response.toVersion;
                }
              } else if (response.mode === "snapshot") {
                setLines(response.lines || []);
                setImageSrc(response.image || null);
                if (typeof response.version === "number") {
                  roomVersionRef.current = response.version;
                }
              }
            }
          }
        );
      } else if (version === current + 1) {
        roomVersionRef.current = version;
      }
    },
    [socket, roomId]
  );

  useEffect(() => {
    if (!socket) return;

    // 1. Initial canvas state with version
    socket.on(
      "initCanvas",
      ({
        lines: initialLines,
        image,
        version,
      }: {
        lines?: LineData[];
        image?: string | null;
        version?: number;
      }) => {
        setLines(initialLines || []);
        setImageSrc(image || null);
        if (typeof version === "number") {
          roomVersionRef.current = version;
        }
      }
    );

    // 2. Catch-up missed operations after reconnecting
    socket.on(
      "catchUp",
      ({
        toVersion,
        operations,
      }: {
        fromVersion: number;
        toVersion: number;
        operations: RoomOperation[];
      }) => {
        setLines((prev) => {
          let updated = [...prev];
          for (const op of operations) {
            updated = applyOperationToLines(updated, op);
            if (op.type === "addImage") {
              setImageSrc(op.image || null);
            }
          }
          return updated;
        });
        roomVersionRef.current = toVersion;
      }
    );

    // 3. Delta updates: element creation
    socket.on(
      "element:create",
      ({
        element,
        version,
      }: {
        element?: LineData;
        version?: number;
        userId?: string;
      }) => {
        if (element && element.id) {
          setLines((prev) => {
            if (prev.some((e) => e.id === element.id)) return prev;
            return [...prev, element];
          });
        }
        handleIncomingVersion(version);
      }
    );

    // Backward compatibility for drawEnd
    socket.on(
      "drawEnd",
      ({ line, version }: { line?: LineData; version?: number }) => {
        if (line && line.id) {
          setLines((prev) => {
            if (prev.some((e) => e.id === line.id)) return prev;
            return [...prev, line];
          });
        }
        handleIncomingVersion(version);
      }
    );

    // 4. Delta updates: element modification
    socket.on(
      "element:update",
      ({
        id,
        patch,
        version,
      }: {
        id: string;
        patch: Partial<LineData>;
        version?: number;
      }) => {
        setLines((prev) =>
          prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
        );
        handleIncomingVersion(version);
      }
    );

    // 5. Delta updates: element deletion (including undo operations)
    socket.on(
      "element:delete",
      ({
        id,
        version,
      }: {
        id: string;
        version?: number;
        isUndo?: boolean;
      }) => {
        setLines((prev) => prev.filter((e) => e.id !== id));
        // Remove from local user created stack if present
        myCreatedIds.current = myCreatedIds.current.filter((itemId) => itemId !== id);
        handleIncomingVersion(version);
      }
    );

    // 6. Delta updates: element reordering
    socket.on(
      "element:reorder",
      ({
        id,
        to,
        version,
      }: {
        id: string;
        to: "front" | "back";
        version?: number;
      }) => {
        setLines((prev) => {
          const idx = prev.findIndex((e) => e.id === id);
          if (idx === -1) return prev;
          const item = prev[idx];
          const without = prev.filter((e) => e.id !== id);
          return to === "front" ? [...without, item] : [item, ...without];
        });
        handleIncomingVersion(version);
      }
    );

    // 7. Background image update
    socket.on(
      "addImage",
      ({
        image,
        version,
      }: {
        image: string | null;
        version?: number;
      }) => {
        setImageSrc(image);
        handleIncomingVersion(version);
      }
    );

    // 8. Clear whiteboard
    socket.on(
      "clearBoard",
      ({ version }: { version?: number } = {}) => {
        setLines([]);
        setImageSrc(null);
        myCreatedIds.current = [];
        handleIncomingVersion(version);
      }
    );

    // Legacy bulk update handler
    socket.on(
      "updateElements",
      ({ lines: newLines, version }: { lines?: LineData[]; version?: number }) => {
        if (newLines) setLines(newLines);
        handleIncomingVersion(version);
      }
    );

    return () => {
      socket.off("initCanvas");
      socket.off("catchUp");
      socket.off("element:create");
      socket.off("drawEnd");
      socket.off("element:update");
      socket.off("element:delete");
      socket.off("element:reorder");
      socket.off("addImage");
      socket.off("clearBoard");
      socket.off("updateElements");
    };
  }, [socket, handleIncomingVersion]);

  // Undo as an operation (race-condition free)
  const undo = useCallback(async () => {
    if (!socket) return;
    const targetId = myCreatedIds.current.pop();
    try {
      const ack = await emitWithAck(socket, "undo", {
        roomId,
        userId: socket.id,
        elementId: targetId,
      });
      if (typeof ack?.version === "number") {
        onVersionUpdate(ack.version);
      }
    } catch (err) {
      console.warn("Undo failed:", err);
      // Re-add to stack if it failed
      if (targetId) {
        myCreatedIds.current.push(targetId);
      }
    }
  }, [socket, roomId, onVersionUpdate]);

  // Redo as an operation
  const redo = useCallback(async () => {
    if (!socket) return;
    try {
      const response = await emitWithAck<{
        success: boolean;
        element?: LineData;
        version?: number;
      }>(socket, "redo", {
        roomId,
        userId: socket.id,
      });
      if (response && response.element?.id) {
        myCreatedIds.current.push(response.element.id);
      }
      if (typeof response?.version === "number") {
        onVersionUpdate(response.version);
      }
    } catch (err) {
      console.warn("Redo failed:", err);
    }
  }, [socket, roomId, onVersionUpdate]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (file && socket) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const img = new window.Image();
        img.onload = async () => {
          let w = img.width || 300;
          let h = img.height || 300;
          const maxDim = 400;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }

          const stage = stageRef.current;
          let posX = 100;
          let posY = 100;
          if (stage) {
            const scale = stage.scaleX() || 1;
            posX = Math.round((-stage.x() + stage.width() / 2) / scale - w / 2);
            posY = Math.round((-stage.y() + stage.height() / 2) / scale - h / 2);
          }

          const imageElement: LineData = {
            id: generateId("image"),
            userId: socket.id,
            type: "image",
            src: result,
            x: posX,
            y: posY,
            width: w,
            height: h,
            createdAt: Date.now(),
          };

          setLines((prev) => [...prev, imageElement]);
          onElementCreated(imageElement);
          try {
            const ack = await emitWithAck(socket, "element:create", {
              roomId,
              element: imageElement,
            });
            if (typeof ack?.version === "number") {
              onVersionUpdate(ack.version);
            }
          } catch (err) {
            console.warn("Upload image element:create failed:", err);
          }
        };
        img.src = result;
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    }
  };

  const clearBoard = useCallback(async () => {
    if (!socket) return;
    setLines([]);
    setImageSrc(null);
    myCreatedIds.current = [];
    try {
      const ack = await emitWithAck(socket, "clearBoard", roomId);
      if (typeof ack?.version === "number") {
        onVersionUpdate(ack.version);
      }
    } catch (err) {
      console.warn("Clear board failed:", err);
    }
  }, [socket, roomId, onVersionUpdate]);

  const exportImage = () => {
    if (stageRef.current) {
      const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
      const link = document.createElement("a");
      link.href = uri;
      link.download = `whiteboard-${roomId}.png`;
      link.click();
    } else {
      const canvas = document.querySelector("canvas");
      if (canvas) {
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = `whiteboard-${roomId}.png`;
        link.click();
      }
    }
  };

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

      const key = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "y") {
        e.preventDefault();
        redo();
        return;
      }

      switch (key) {
        case "v":
          setTool("select");
          break;
        case "h":
          setTool("hand");
          break;
        case "p":
          setTool("pen");
          break;
        case "r":
          setTool("rectangle");
          break;
        case "c":
          setTool("circle");
          break;
        case "a":
          setTool("arrow");
          break;
        case "l":
          setTool("line");
          break;
        case "t":
          setTool("text");
          break;
        case "e":
          setTool("eraser");
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  return (
    <div className="position-relative h-100">
      <WhiteboardCanvas
        tool={tool}
        color={color}
        lineWidth={lineWidth}
        imageSrc={imageSrc}
        lines={lines}
        setLines={setLines}
        socket={socket}
        roomId={roomId}
        stageRef={stageRef}
        onElementCreated={onElementCreated}
        onVersionUpdate={onVersionUpdate}
      />
      <div className="position-fixed bottom-0 start-50 translate-middle-x mb-3 z-50">
        <Toolbar
          tool={tool}
          setTool={setTool}
          color={color}
          setColor={setColor}
          lineWidth={lineWidth}
          setLineWidth={setLineWidth}
          handleImageUpload={handleImageUpload}
          undo={undo}
          redo={redo}
          clearBoard={clearBoard}
          exportImage={exportImage}
        />
      </div>
    </div>
  );
};

export default Main;
