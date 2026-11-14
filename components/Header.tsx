/* eslint-disable @next/next/no-img-element */
import React, { useState } from "react";
import ThemeToggleButton from "./models/ModeToggle";

interface HeaderProps {
  userName: string;
  profileImage: string;
}

const Header: React.FC<HeaderProps> = ({ userName, profileImage }) => {
  const [imgError, setImgError] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex justify-between items-center px-4 py-2.5 shadow-sm bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 transition-colors duration-200">
      {/* Whiteboard Name */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
          W
        </div>
        <h1 className="text-base font-bold text-gray-900 dark:text-white mb-0">
          Whiteboard
        </h1>
      </div>

      {/* User Profile Section */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {!imgError ? (
            <img
              src={profileImage}
              alt={userName}
              onError={() => setImgError(true)}
              className="rounded-full w-8 h-8 object-cover border border-gray-200 dark:border-gray-700"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold uppercase">
              {userName ? userName.charAt(0) : "U"}
            </div>
          )}
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 hidden sm:inline">
            {userName}
          </span>
        </div>

        {/* Theme Toggle Button */}
        <ThemeToggleButton />
      </div>
    </header>
  );
};

export default Header;
