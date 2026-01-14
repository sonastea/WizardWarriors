/**
 * Simple UI sound player for React components.
 * Uses HTML5 Audio API directly (independent of Phaser).
 */

const UI_SOUNDS = {
  buttonJoin: "/assets/audio/button-join.ogg",
  buttonLeave: "/assets/audio/button-leave.ogg",
} as const;

export type UISoundKey = keyof typeof UI_SOUNDS;

let volume = 0.5;

/**
 * Play a UI sound effect
 */
export function playUISound(key: UISoundKey): void {
  try {
    const audio = new Audio(UI_SOUNDS[key]);
    audio.volume = volume;
    audio.play();
  } catch (error) {
    console.log("Failed to play UI sound: ", error);
  }
}

/**
 * Set the volume for UI sounds (0.0 to 1.0)
 */
export function setUISoundVolume(newVolume: number): void {
  volume = Math.max(0, Math.min(1, newVolume));
}
