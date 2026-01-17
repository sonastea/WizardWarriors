import { useEffect, useRef } from "react";

interface TileIconProps {
  /** Path to the spritesheet image */
  spritesheet: string;
  /** Frame index in the spritesheet (0-based) */
  frame: number;
  /** Width of each frame in the spritesheet */
  frameWidth?: number;
  /** Height of each frame in the spritesheet */
  frameHeight?: number;
  /** Number of columns in the spritesheet (for calculating frame position) */
  columns?: number;
  /** Display size of the icon */
  size?: number;
  /** Optional CSS class name */
  className?: string;
}

/**
 * Renders a single tile/frame from a spritesheet as a canvas element.
 * Used for displaying tile icons in UI elements like the How to Play legend.
 */
const TileIcon = ({
  spritesheet,
  frame,
  frameWidth = 16,
  frameHeight = 16,
  columns = 17,
  size = 16,
  className,
}: TileIconProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      const col = frame % columns;
      const row = Math.floor(frame / columns);
      const sx = col * frameWidth;
      const sy = row * frameHeight;

      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, sx, sy, frameWidth, frameHeight, 0, 0, size, size);
    };
    img.src = spritesheet;
  }, [spritesheet, frame, frameWidth, frameHeight, columns, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: "pixelated" }}
    />
  );
};

export default TileIcon;
