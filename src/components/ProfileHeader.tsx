import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { IoSettingsOutline } from "react-icons/io5";
import { useNavigate } from "react-router-dom";
import Jazzicon from "react-jazzicon/dist/Jazzicon";
import useWallet from "../hooks/useWallet";

type MenuPos = { top: number; right: number };

const ProfileHeader: React.FC = () => {
  const { selectedWalletIndex, accountPath } = useWallet();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const { name, clearToken } = useWallet();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  const toggleMenu = () => {
    setIsMenuOpen((prev) => !prev);
  };

  const updateMenuPosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // Fixed coords so the menu is not trapped under .main-balance-hero /
    // backdrop-filter stacking on .main-home-card.
    setMenuPos({
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  const handleClickOutside = (event: MouseEvent) => {
    const t = event.target as Node;
    if (
      menuRef.current?.contains(t) ||
      buttonRef.current?.contains(t)
    ) {
      return;
    }
    setIsMenuOpen(false);
  };

  const handleLockScreen = () => {
    clearToken();
    navigate("/locked");
  };

  const go = (path: string) => {
    setIsMenuOpen(false);
    navigate(path);
  };

  useLayoutEffect(() => {
    if (!isMenuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
  }, [isMenuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isMenuOpen) return;

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("resize", updateMenuPosition);
    // Popup content scrolls on #root
    const scrollRoot = document.getElementById("root");
    scrollRoot?.addEventListener("scroll", updateMenuPosition, { passive: true });
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", updateMenuPosition);
      scrollRoot?.removeEventListener("scroll", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isMenuOpen, updateMenuPosition]);

  const menu =
    isMenuOpen &&
    menuPos &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        className="p-5 bg-[#272727] rounded-[10px] border border-[#fdb913] w-[210px] shadow-xl"
        style={{
          position: "fixed",
          top: menuPos.top,
          right: menuPos.right,
          zIndex: 2147483000,
        }}
      >
        <p
          className="text-white text-lg font-normal cursor-pointer"
          role="menuitem"
          onClick={() => go("/account-details")}
        >
          Account details
        </p>
        <div className="border border-white/20 my-2" />
        <p
          className="text-white text-lg font-normal cursor-pointer"
          role="menuitem"
          onClick={() => go("/manage-account")}
        >
          Manage Accounts
        </p>
        <div className="border border-white/20 my-2" />
        <p
          className="text-white text-lg font-normal cursor-pointer"
          role="menuitem"
          onClick={() => go("/select-node")}
        >
          Select Node
        </p>
        <div className="border border-white/20 my-2" />
        <p
          className="text-white text-lg font-normal cursor-pointer"
          role="menuitem"
          onClick={handleLockScreen}
        >
          Lock Screen
        </p>
      </div>,
      document.body,
    );

  return (
    <div className="flex justify-between w-full relative z-30">
      <div className="flex items-center gap-3 min-w-0">
        <Jazzicon diameter={60} seed={selectedWalletIndex} />
        <div className="grid gap-1 min-w-0">
          <h1 className="text-white text-xl font-semibold truncate">{name}</h1>
          <p className="text-white/30 text-xs font-normal">
            {accountPath(selectedWalletIndex)}
          </p>
        </div>
      </div>
      <div className="relative shrink-0">
        <div
          ref={buttonRef}
          onClick={toggleMenu}
          className="w-[70px] h-[70px] bg-white/5 rounded-full border border-primary flex justify-center items-center cursor-pointer"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
        >
          <IoSettingsOutline
            className={`text-white text-3xl transition-transform duration-300 ${
              isMenuOpen ? "rotate-90" : "rotate-0"
            }`}
          />
        </div>
        {menu}
      </div>
    </div>
  );
};

export default ProfileHeader;
