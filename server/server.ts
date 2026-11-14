import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";

interface User {
  id: string;
  name: string;
  color?: string;
}

interface OperationRecord {
  version: number;
  type: string;
  payload: any;
  timestamp: number;
}

interface UndoRecord {
  userId: string;
  element?: any;
  image?: string | null;
  action: "element" | "image";
}

interface RoomData {
  users: User[];
  lines: any[];
  image: string | null;
  version: number;
  operations: OperationRecord[];
  undoStack: UndoRecord[];
  cleanupTimer?: NodeJS.Timeout;
}

const MAX_OPERATIONS_HISTORY = 200;

const USER_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#10b981", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#e11d48", "#84cc16"
];

function assignUserColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function generateServerId(prefix = "el"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

function getOrCreateRoom(rooms: Record<string, RoomData>, roomId: string): RoomData {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: [],
      lines: [],
      image: null,
      version: 0,
      operations: [],
      undoStack: [],
    };
  } else if (rooms[roomId].cleanupTimer) {
    clearTimeout(rooms[roomId].cleanupTimer);
    delete rooms[roomId].cleanupTimer;
  }
  return rooms[roomId];
}

function recordOperation(room: RoomData, type: string, payload: any): number {
  room.version++;
  const op: OperationRecord = {
    version: room.version,
    type,
    payload,
    timestamp: Date.now(),
  };
  room.operations.push(op);
  if (room.operations.length > MAX_OPERATIONS_HISTORY) {
    room.operations.shift();
  }
  return room.version;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Confirmation route
app.get("/", (req, res) => {
  res.send("Backend server is running and ready to accept connections!");
});

const rooms: Record<string, RoomData> = {};

io.on("connection", (socket: Socket) => {
  // 1. Join room (with version check for catch-up)
  socket.on(
    "joinRoom",
    (
      { roomId, name, lastVersion }: { roomId: string; name: string; lastVersion?: number },
      callback?: (res: any) => void
    ) => {
      socket.join(roomId);
      const room = getOrCreateRoom(rooms, roomId);
      const userColor = assignUserColor(socket.id);
      room.users = room.users.filter((user) => user.id !== socket.id);
      room.users.push({ id: socket.id, name, color: userColor });

      let caughtUp = false;
      // Catch up if reconnecting client passed a recent lastVersion
      if (typeof lastVersion === "number" && lastVersion > 0 && lastVersion < room.version) {
        const earliestAvailable = room.operations[0]?.version;
        if (earliestAvailable !== undefined && lastVersion >= earliestAvailable - 1) {
          const missedOps = room.operations.filter((op) => op.version > lastVersion);
          socket.emit("catchUp", {
            fromVersion: lastVersion,
            toVersion: room.version,
            operations: missedOps,
            color: userColor,
          });
          caughtUp = true;
        }
      }

      if (!caughtUp) {
        socket.emit("initCanvas", {
          lines: room.lines,
          image: room.image,
          version: room.version,
          color: userColor,
        });
      }

      io.to(roomId).emit("userJoined", room.users);
      if (typeof callback === "function") {
        callback({ success: true, version: room.version, color: userColor });
      }
    }
  );

  // 2. Explicit catch-up request
  socket.on(
    "syncRoom",
    (
      { roomId, lastVersion }: { roomId: string; lastVersion?: number },
      callback?: (res: any) => void
    ) => {
      const room = rooms[roomId];
      if (!room) {
        if (typeof callback === "function") callback({ success: false, error: "Room not found" });
        return;
      }

      if (typeof lastVersion === "number" && lastVersion > 0 && lastVersion < room.version) {
        const earliestAvailable = room.operations[0]?.version;
        if (earliestAvailable !== undefined && lastVersion >= earliestAvailable - 1) {
          const missedOps = room.operations.filter((op) => op.version > lastVersion);
          if (typeof callback === "function") {
            callback({
              success: true,
              mode: "delta",
              fromVersion: lastVersion,
              toVersion: room.version,
              operations: missedOps,
            });
          }
          return;
        }
      }

      if (typeof callback === "function") {
        callback({
          success: true,
          mode: "snapshot",
          version: room.version,
          lines: room.lines,
          image: room.image,
        });
      }
    }
  );

  // Ephemeral live drawing previews
  socket.on(
    "drawStart",
    ({ roomId, point, element }: { roomId: string; point?: any; element?: any }) => {
      socket.to(roomId).emit("drawStart", { point, element, userId: socket.id });
    }
  );

  socket.on(
    "drawProgress",
    ({ roomId, point, element }: { roomId: string; point?: any; element?: any }) => {
      socket.to(roomId).emit("drawProgress", { point, element, userId: socket.id });
    }
  );

  // Delta: Create Element (also handles drawEnd)
  const handleCreateElement = (
    { roomId, element, line }: { roomId: string; element?: any; line?: any },
    callback?: (res: any) => void
  ) => {
    const room = rooms[roomId];
    const targetEl = element || line;
    if (room && targetEl) {
      if (!targetEl.id) {
        targetEl.id = generateServerId(targetEl.type || "el");
      }
      if (!targetEl.userId) {
        targetEl.userId = socket.id;
      }
      if (!targetEl.createdAt) {
        targetEl.createdAt = Date.now();
      }

      room.lines.push(targetEl);
      const version = recordOperation(room, "element:create", { element: targetEl });

      socket.to(roomId).emit("element:create", { element: targetEl, version, userId: socket.id });
      // Backward compatibility
      socket.to(roomId).emit("drawEnd", { line: targetEl, userId: socket.id, version });

      if (typeof callback === "function") {
        callback({ success: true, version, id: targetEl.id });
      }
    } else {
      if (typeof callback === "function") {
        callback({ success: false, error: "Room or element missing" });
      }
    }
  };

  socket.on("element:create", handleCreateElement);
  socket.on("drawEnd", handleCreateElement);
  socket.on("drawing", handleCreateElement);

  // Delta: Update Element (e.g. position, size, color, width)
  socket.on(
    "element:update",
    (
      { roomId, id, patch }: { roomId: string; id: string; patch: any },
      callback?: (res: any) => void
    ) => {
      const room = rooms[roomId];
      if (room && id && patch) {
        const item = room.lines.find((el: any) => el?.id === id);
        if (item) {
          Object.assign(item, patch, { updatedAt: Date.now() });
          const version = recordOperation(room, "element:update", { id, patch });
          socket.to(roomId).emit("element:update", { id, patch, version, userId: socket.id });
          if (typeof callback === "function") callback({ success: true, version });
        } else {
          if (typeof callback === "function") callback({ success: false, error: "Element not found" });
        }
      } else {
        if (typeof callback === "function") callback({ success: false, error: "Invalid payload" });
      }
    }
  );

  // Delta: Delete Element
  socket.on(
    "element:delete",
    (
      { roomId, id }: { roomId: string; id: string },
      callback?: (res: any) => void
    ) => {
      const room = rooms[roomId];
      if (room && id) {
        const idx = room.lines.findIndex((el: any) => el?.id === id);
        if (idx !== -1) {
          const deleted = room.lines.splice(idx, 1)[0];
          room.undoStack.push({ userId: socket.id, element: deleted, action: "element" });
          const version = recordOperation(room, "element:delete", { id });
          socket.to(roomId).emit("element:delete", { id, version, userId: socket.id });
          if (typeof callback === "function") callback({ success: true, version });
        } else {
          if (typeof callback === "function") callback({ success: false, error: "Element not found" });
        }
      } else {
        if (typeof callback === "function") callback({ success: false, error: "Invalid payload" });
      }
    }
  );

  // Delta: Reorder Element (bring to front / send to back)
  socket.on(
    "element:reorder",
    (
      { roomId, id, to }: { roomId: string; id: string; to: "front" | "back" },
      callback?: (res: any) => void
    ) => {
      const room = rooms[roomId];
      if (room && id) {
        const idx = room.lines.findIndex((el: any) => el?.id === id);
        if (idx !== -1) {
          const [item] = room.lines.splice(idx, 1);
          if (to === "front") {
            room.lines.push(item);
          } else {
            room.lines.unshift(item);
          }
          const version = recordOperation(room, "element:reorder", { id, to });
          socket.to(roomId).emit("element:reorder", { id, to, version, userId: socket.id });
          if (typeof callback === "function") callback({ success: true, version });
        } else {
          if (typeof callback === "function") callback({ success: false, error: "Element not found" });
        }
      } else {
        if (typeof callback === "function") callback({ success: false, error: "Invalid payload" });
      }
    }
  );

  // Ephemeral shape movement during dragging
  socket.on(
    "shapeMove",
    ({ roomId, id, x, y }: { roomId: string; id: string; x: number; y: number }) => {
      if (rooms[roomId]) {
        const item = rooms[roomId].lines.find((el: any) => el?.id === id);
        if (item) {
          item.x = x;
          item.y = y;
        }
        socket.to(roomId).emit("shapeMove", { id, x, y, userId: socket.id });
      }
    }
  );

  // Undo as an operation (per-user / element targeted, avoids overwriting other users' elements)
  socket.on(
    "undo",
    (
      data: { roomId: string; userId?: string; elementId?: string; lines?: any[]; image?: string | null },
      callback?: (res: any) => void
    ) => {
      const { roomId, userId, elementId } = data;
      const room = rooms[roomId];
      if (!room) {
        if (typeof callback === "function") callback({ success: false, error: "Room not found" });
        return;
      }

      const targetUserId = userId || socket.id;

      // 1. Try to find the targeted element to undo
      let targetIndex = -1;
      if (elementId) {
        targetIndex = room.lines.findIndex((el: any) => el?.id === elementId);
      }
      if (targetIndex === -1 && targetUserId) {
        // Find last element created by this user
        for (let i = room.lines.length - 1; i >= 0; i--) {
          if (room.lines[i]?.userId === targetUserId) {
            targetIndex = i;
            break;
          }
        }
      }
      // Fallback to the very last element in room if none found for user
      if (targetIndex === -1 && room.lines.length > 0) {
        targetIndex = room.lines.length - 1;
      }

      if (targetIndex !== -1) {
        const removedElement = room.lines.splice(targetIndex, 1)[0];
        room.undoStack.push({ userId: targetUserId, element: removedElement, action: "element" });
        const version = recordOperation(room, "element:delete", { id: removedElement.id, isUndo: true });

        io.to(roomId).emit("element:delete", { id: removedElement.id, version, isUndo: true });
        if (typeof callback === "function") {
          callback({ success: true, version, elementId: removedElement.id });
        }
        return;
      }

      // If no lines to undo, check if there's an image to undo
      if (room.image) {
        const oldImage = room.image;
        room.image = null;
        room.undoStack.push({ userId: targetUserId, image: oldImage, action: "image" });
        const version = recordOperation(room, "addImage", { image: null, isUndo: true });
        io.to(roomId).emit("addImage", { image: null, version });
        if (typeof callback === "function") {
          callback({ success: true, version, imageUndone: true });
        }
        return;
      }

      // Legacy fallback: if client passed lines array and room has no elements
      if (Array.isArray(data.lines)) {
        room.lines = data.lines;
        room.image = data.image ?? null;
        const version = recordOperation(room, "updateElements", { lines: data.lines });
        socket.to(roomId).emit("undo", { lines: data.lines, image: data.image, version });
        if (typeof callback === "function") callback({ success: true, version });
        return;
      }

      if (typeof callback === "function") {
        callback({ success: false, message: "Nothing to undo" });
      }
    }
  );

  // Redo as an operation
  socket.on(
    "redo",
    (
      data: { roomId: string; userId?: string; lines?: any[]; image?: string | null },
      callback?: (res: any) => void
    ) => {
      const { roomId, userId } = data;
      const room = rooms[roomId];
      if (!room) {
        if (typeof callback === "function") callback({ success: false, error: "Room not found" });
        return;
      }

      const targetUserId = userId || socket.id;

      // Find the last item in undo stack for this user
      let undoIdx = -1;
      for (let i = room.undoStack.length - 1; i >= 0; i--) {
        if (room.undoStack[i]?.userId === targetUserId) {
          undoIdx = i;
          break;
        }
      }
      if (undoIdx === -1 && room.undoStack.length > 0) {
        undoIdx = room.undoStack.length - 1;
      }

      if (undoIdx !== -1) {
        const [record] = room.undoStack.splice(undoIdx, 1);
        if (record.action === "element" && record.element) {
          room.lines.push(record.element);
          const version = recordOperation(room, "element:create", { element: record.element, isRedo: true });
          io.to(roomId).emit("element:create", { element: record.element, version, isRedo: true });
          if (typeof callback === "function") {
            callback({ success: true, version, element: record.element });
          }
          return;
        } else if (record.action === "image" && record.image) {
          room.image = record.image;
          const version = recordOperation(room, "addImage", { image: record.image, isRedo: true });
          io.to(roomId).emit("addImage", { image: record.image, version });
          if (typeof callback === "function") {
            callback({ success: true, version });
          }
          return;
        }
      }

      // Legacy fallback
      if (Array.isArray(data.lines)) {
        room.lines = data.lines;
        room.image = data.image ?? null;
        const version = recordOperation(room, "updateElements", { lines: data.lines });
        socket.to(roomId).emit("redo", { lines: data.lines, image: data.image, version });
        if (typeof callback === "function") callback({ success: true, version });
        return;
      }

      if (typeof callback === "function") {
        callback({ success: false, message: "Nothing to redo" });
      }
    }
  );

  // Background image
  socket.on(
    "addImage",
    ({ roomId, image }: { roomId: string; image: string }, callback?: (res: any) => void) => {
      const room = rooms[roomId];
      if (room) {
        room.image = image;
        const version = recordOperation(room, "addImage", { image });
        socket.to(roomId).emit("addImage", { image, version });
        if (typeof callback === "function") callback({ success: true, version });
      }
    }
  );

  // Clear board
  socket.on("clearBoard", (roomId: string, callback?: (res: any) => void) => {
    const room = rooms[roomId];
    if (room) {
      room.lines = [];
      room.image = null;
      room.undoStack = [];
      const version = recordOperation(room, "clearBoard", {});
      io.to(roomId).emit("clearBoard", { version });
      if (typeof callback === "function") callback({ success: true, version });
    }
  });

  // Legacy bulk updateElements handler for backward compatibility
  socket.on(
    "updateElements",
    ({ roomId, lines }: { roomId: string; lines: any[] }, callback?: (res: any) => void) => {
      const room = rooms[roomId];
      if (room && Array.isArray(lines)) {
        room.lines = lines;
        const version = recordOperation(room, "updateElements", { lines });
        socket.to(roomId).emit("updateElements", { lines, version });
        if (typeof callback === "function") callback({ success: true, version });
      }
    }
  );

  // Cursor mouse movement
  socket.on(
    "mouseMove",
    ({ roomId, x, y }: { roomId: string; x: number; y: number }) => {
      const user = rooms[roomId]?.users?.find((u) => u.id === socket.id);
      if (user) {
        socket.to(roomId).emit("mouseUpdate", {
          id: socket.id,
          name: user.name,
          color: user.color,
          x,
          y,
        });
      }
    }
  );

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      if (rooms[roomId] && rooms[roomId].users) {
        rooms[roomId].users = rooms[roomId].users.filter((user) => user.id !== socket.id);
        io.to(roomId).emit("userLeft", rooms[roomId].users);

        if (rooms[roomId].users.length === 0) {
          if (rooms[roomId].cleanupTimer) {
            clearTimeout(rooms[roomId].cleanupTimer);
          }
          rooms[roomId].cleanupTimer = setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].users.length === 0) {
              delete rooms[roomId];
            }
          }, 60000);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Listening on PORT ${PORT}`);
});
