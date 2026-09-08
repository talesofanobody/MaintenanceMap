import { useEffect } from "react";

export default function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Photo preview">
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="lightbox-close" aria-label="Close">
        ✕
      </button>
    </div>
  );
}
