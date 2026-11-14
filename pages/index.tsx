import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import ThemeToggleButton from "@/components/models/ModeToggle";

const Home = () => {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("whiteboard_username");
      if (stored) setName(stored);
    } catch {
      // ignore
    }
  }, []);

  const createRoom = () => {
    if (!name.trim()) return;
    const trimmed = name.trim();
    try {
      sessionStorage.setItem("whiteboard_username", trimmed);
    } catch {}
    const id = Math.random().toString(36).substring(2, 10);
    router.push(`/${id}?name=${encodeURIComponent(trimmed)}`);
  };

  const joinRoom = () => {
    if (name.trim() && roomId.trim()) {
      const trimmedName = name.trim();
      const trimmedRoom = roomId.trim();
      try {
        sessionStorage.setItem("whiteboard_username", trimmedName);
      } catch {}
      router.push(`/${trimmedRoom}?name=${encodeURIComponent(trimmedName)}`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isJoining) {
      joinRoom();
    } else {
      createRoom();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex flex-col transition-colors duration-300">
      {/* Top bar with Dark Mode toggle */}
      <header className="p-4 flex justify-between items-center max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
            W
          </div>
          <span className="font-bold text-gray-800 dark:text-white text-lg">
            Collaborative Whiteboard
          </span>
        </div>
        <ThemeToggleButton />
      </header>

      {/* Main Card */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8 max-w-md w-full transition-all">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-2">
              Start Collaborating
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Draw, brainstorm, and share ideas in real-time with your team.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                Your Display Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors"
              />
            </div>

            {!isJoining ? (
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={createRoom}
                  disabled={!name.trim()}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-md hover:shadow-lg transition-all"
                >
                  Create New Room
                </button>
                <button
                  type="button"
                  onClick={() => setIsJoining(true)}
                  disabled={!name.trim()}
                  className="w-full py-2.5 px-4 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 border border-blue-600 dark:border-blue-500 font-medium rounded-lg transition-all"
                >
                  Join Existing Room
                </button>
              </div>
            ) : (
              <div className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                    Room Code / ID
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. abc123xyz"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors font-mono"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!name.trim() || !roomId.trim()}
                    className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg shadow-md transition-all"
                  >
                    Join Room
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsJoining(false)}
                    className="py-2.5 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  );
};

export default Home;
