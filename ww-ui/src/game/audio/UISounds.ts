/**
 * Simple UI sound player for React components.
 * Uses HTML5 Audio API directly (independent of Phaser).
 * Audio files are preloaded to avoid playback delays.
 */

const UI_SOUNDS = {
  buttonJoin: "/assets/audio/button-join.ogg",
  buttonLeave: "/assets/audio/button-leave.ogg",
} as const;

export type UISoundKey = keyof typeof UI_SOUNDS;

let volume = 0.5;

const preloadedAudio: Map<UISoundKey, HTMLAudioElement> = new Map();

/**
 * Preload all UI sounds so they play instantly when triggered.
 * Call this early (e.g., on app initialization).
 */
export function preloadUISounds(): void {
  for (const [key, src] of Object.entries(UI_SOUNDS)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.load();
    preloadedAudio.set(key as UISoundKey, audio);
  }
}

/**
 * Play a UI sound effect
 */
export function playUISound(key: UISoundKey): void {
  try {
    const preloaded = preloadedAudio.get(key);
    if (preloaded) {
      // Clone the preloaded audio to allow overlapping plays
      const audio = preloaded.cloneNode() as HTMLAudioElement;
      audio.volume = volume;
      audio.play();
    } else {
      const audio = new Audio(UI_SOUNDS[key]);
      audio.volume = volume;
      audio.play();
    }
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
