import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * A photo, over the whole window.
 *
 * Rendered into `document.body` rather than where it is used, because
 * `position: fixed` stops meaning "the viewport" the moment any ancestor has a
 * transform, a filter or paint containment — it means that ancestor instead.
 * That is how this ended up opening at the top of a long inspection: a page
 * animation left an identity transform behind, and the viewer anchored to the
 * page rather than the screen. The animation is fixed too, but a portal is what
 * stops the next transform anybody adds from doing it again.
 */
export default function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Nothing should scroll behind an image that fills the screen.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Photo preview">
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="lightbox-close" aria-label="Close">
        ✕
      </button>
    </div>,
    document.body
  );
}
