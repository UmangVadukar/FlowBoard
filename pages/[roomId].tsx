import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import io, { Socket } from "socket.io-client";
import dynamic from "next/dynamic";
import Header from "../components/Header";
import { User, getUserColor } from "../types/types";

const Whiteboard = dynamic(() => import("../components/Main"), {
  ssr: false,
});

const SOCKET_SERVER_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

const Room: React.FC = () => {
  const router = useRouter();
  const { roomId, name: queryName } = router.query;
  const [userName, setUserName] = useState<string>("");
  const [nameInput, setNameInput] = useState<string>("");
  const [users, setUsers] = useState<User[]>([]);
  const [showUsers, setShowUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const lastVersionRef = useRef<number>(0);

  // Initialize or retrieve user name
  useEffect(() => {
    if (!router.isReady) return;

    if (typeof queryName === "string" && queryName.trim()) {
      setUserName(queryName.trim());
      try {
        sessionStorage.setItem("whiteboard_username", queryName.trim());
      } catch {
        // ignore
      }
    } else {
      try {
        const storedName = sessionStorage.getItem("whiteboard_username");
        if (storedName) {
          setUserName(storedName);
        }
      } catch {
        // ignore
      }
    }
  }, [router.isReady, queryName]);

  const connectSocket = useCallback((rId: string, uName: string) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    setError(null);

    const s = io(SOCKET_SERVER_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => {
      setError(null);
      s.emit("joinRoom", {
        roomId: rId,
        name: uName,
        lastVersion:
          lastVersionRef.current > 0 ? lastVersionRef.current : undefined,
      });
    });

    s.on("initCanvas", (data: { version?: number }) => {
      if (typeof data?.version === "number") {
        lastVersionRef.current = data.version;
      }
    });

    s.on("catchUp", (data: { toVersion?: number }) => {
      if (typeof data?.toVersion === "number") {
        lastVersionRef.current = data.toVersion;
      }
    });

    s.on("element:create", (data: { version?: number }) => {
      if (typeof data?.version === "number") {
        lastVersionRef.current = Math.max(lastVersionRef.current, data.version);
      }
    });

    s.on("element:update", (data: { version?: number }) => {
      if (typeof data?.version === "number") {
        lastVersionRef.current = Math.max(lastVersionRef.current, data.version);
      }
    });

    s.on("element:delete", (data: { version?: number }) => {
      if (typeof data?.version === "number") {
        lastVersionRef.current = Math.max(lastVersionRef.current, data.version);
      }
    });

    s.on("clearBoard", (data?: { version?: number }) => {
      if (typeof data?.version === "number") {
        lastVersionRef.current = Math.max(lastVersionRef.current, data.version);
      }
    });

    s.on("userJoined", (updatedUsers: User[]) => {
      setUsers(updatedUsers);
    });

    s.on("userLeft", (updatedUsers: User[]) => {
      setUsers(updatedUsers);
    });

    s.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setError(
        `Failed to connect to backend server at ${SOCKET_SERVER_URL}. Please ensure the server is running on port 3001.`
      );
    });

    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof roomId === "string" && userName) {
      const cleanup = connectSocket(roomId, userName);
      return () => {
        cleanup();
      };
    }
  }, [roomId, userName, connectSocket]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      const trimmed = nameInput.trim();
      setUserName(trimmed);
      try {
        sessionStorage.setItem("whiteboard_username", trimmed);
      } catch {
        // ignore
      }
      router.replace(
        {
          pathname: router.pathname,
          query: { ...router.query, name: trimmed },
        },
        undefined,
        { shallow: true }
      );
    }
  };

  const copyRoomLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // If roomId is still loading
  if (!router.isReady || !roomId) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center p-6">
          <div className="spinner-border text-primary mb-3" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="text-gray-600 dark:text-gray-300">Loading whiteboard...</p>
        </div>
      </div>
    );
  }

  // If name is not set yet (e.g. joined via direct URL)
  if (!userName) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-8 max-w-md w-full border border-gray-100 dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-white">
            Join Whiteboard Room
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
            Room Code: <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{roomId}</span>
          </p>
          <form onSubmit={handleNameSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Your Name
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Enter your name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!nameInput.trim()}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors shadow-md"
            >
              Enter Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="room h-screen flex flex-col overflow-hidden bg-white dark:bg-gray-900">
      <Header
        userName={userName}
        profileImage={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
          userName
        )}`}
      />

      {/* Error banner if server is disconnected or unreachable */}
      {error && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-lg w-full px-4">
          <div className="bg-red-50 dark:bg-red-900/90 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 p-4 rounded-lg shadow-lg flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="font-semibold text-sm">Server Connection Error</span>
            </div>
            <p className="text-xs">{error}</p>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => connectSocket(roomId as string, userName)}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium transition-colors"
              >
                Retry Connection
              </button>
              <button
                onClick={() => router.push("/")}
                className="px-3 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 text-gray-800 dark:text-white rounded text-xs transition-colors"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-grow relative pt-12">
        {socket && (
          <Whiteboard roomId={roomId as string} socket={socket} />
        )}

        {/* User List Panel */}
        <div
          className={`absolute top-20 right-6 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-40 min-w-[220px]
                     transition-all duration-300 ease-in-out 
                     ${showUsers
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-2 pointer-events-none"
            }`}
        >
          <div className="flex items-center justify-between mb-3 border-b border-gray-100 dark:border-gray-700 pb-2">
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                Room ID
              </div>
              <div className="text-sm font-bold text-blue-600 dark:text-blue-400 font-mono">
                {roomId}
              </div>
            </div>
            <button
              onClick={copyRoomLink}
              title="Copy room link"
              className="text-xs px-2 py-1 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 hover:bg-blue-100 rounded transition-colors"
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center text-xs font-semibold text-gray-600 dark:text-gray-300">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
              Active Users ({users.length})
            </div>
            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded-full text-[10px] font-semibold">
              Live
            </span>
          </div>

          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {users.map((user) => {
              const uColor = user.color || getUserColor(user.id);
              const isMe = user.id === socket?.id;
              return (
                <li
                  key={user.id}
                  className="flex items-center justify-between text-xs text-gray-800 dark:text-gray-200 py-1 px-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: uColor }}
                    />
                    <span className="truncate font-medium">
                      {user.name}
                    </span>
                  </div>
                  {isMe && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-bold text-white ml-2 shrink-0"
                      style={{ backgroundColor: uColor }}
                    >
                      You
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Toggle Button */}
        <button
          onClick={() => setShowUsers(!showUsers)}
          title={showUsers ? "Hide participants" : "Show participants"}
          className="absolute top-20 right-6 p-2 rounded-full bg-white dark:bg-gray-800 shadow-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 z-50 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {showUsers ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Room;
