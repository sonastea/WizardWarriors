import { Scene } from "phaser";

/**
 * Sound effect keys used throughout the game.
 * These keys must match the keys used when loading audio in the preload scene.
 */
export const SoundKeys = {
  POTION_THROW: "sfx-potion-throw",
  POTION_EXPLODE: "sfx-potion-explode",
  PLAYER_FROZEN: "sfx-player-frozen",
  FOOTSTEP: "sfx-footstep",
  PICKUP: "sfx-pickup",
} as const;

export type SoundKey = (typeof SoundKeys)[keyof typeof SoundKeys];

/**
 * Configuration for individual sounds
 */
interface SoundConfig {
  volume?: number;
  rate?: number;
  loop?: boolean;
}

/**
 * SoundManager handles all game audio using Phaser's sound system.
 *
 * To add your own sounds:
 * 1. Place audio files in: ww-ui/public/assets/audio/
 * 2. Load them in MultiplayerPreloadScene.tsx preload() method
 * 3. Use the SoundKeys constants to play them
 *
 * Supported formats: mp3, ogg, wav
 */
export class SoundManager {
  private scene: Scene;
  private masterVolume: number = 0.5;
  private soundEnabled: boolean = true;
  private footstepPlaying: boolean = false;
  private footstepInterval: number | null = null;

  private soundConfigs: Record<SoundKey, SoundConfig> = {
    [SoundKeys.POTION_THROW]: { volume: 0.6, loop: false },
    [SoundKeys.POTION_EXPLODE]: { volume: 0.7, loop: false },
    [SoundKeys.PLAYER_FROZEN]: { volume: 0.8, loop: false },
    [SoundKeys.FOOTSTEP]: { volume: 0.3 },
    [SoundKeys.PICKUP]: { volume: 0.75, loop: false },
  };

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Set master volume (0.0 to 1.0)
   */
  public setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Get current master volume
   */
  public getVolume(): number {
    return this.masterVolume;
  }

  /**
   * Enable or disable all sounds
   */
  public setEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    if (!enabled) {
      this.stopFootsteps();
    }
  }

  /**
   * Check if sounds are enabled
   */
  public isEnabled(): boolean {
    return this.soundEnabled;
  }

  /**
   * Play a sound effect
   */
  public play(soundKey: SoundKey, configOverride?: SoundConfig): void {
    if (!this.soundEnabled) return;

    // Check if the sound exists in the cache
    if (!this.scene.cache.audio.exists(soundKey)) {
      console.warn(
        `Sound "${soundKey}" not loaded. Add it to the preload scene.`
      );
      return;
    }

    const config = { ...this.soundConfigs[soundKey], ...configOverride };
    const finalVolume = (config.volume ?? 1) * this.masterVolume;

    this.scene.sound.play(soundKey, {
      volume: finalVolume,
      rate: config.rate ?? 1,
      loop: config.loop ?? false,
    });
  }

  /**
   * Start playing footstep sounds at regular intervals
   */
  public startFootsteps(): void {
    if (this.footstepPlaying || !this.soundEnabled) return;

    this.footstepPlaying = true;
    this.playFootstep();

    this.footstepInterval = window.setInterval(() => {
      if (this.footstepPlaying && this.soundEnabled) {
        this.playFootstep();
      }
    }, 210);
  }

  /**
   * Play a single footstep with slight pitch variation
   */
  private playFootstep(): void {
    // Add slight pitch variation for more natural sound
    const rateVariation = 0.9 + Math.random() * 0.2; // 0.9 to 1.1
    this.play(SoundKeys.FOOTSTEP, { rate: rateVariation });
  }

  /**
   * Stop playing footstep sounds
   */
  public stopFootsteps(): void {
    this.footstepPlaying = false;
    if (this.footstepInterval !== null) {
      clearInterval(this.footstepInterval);
      this.footstepInterval = null;
    }
  }

  /**
   * Update footsteps based on movement state
   */
  public updateFootsteps(isMoving: boolean): void {
    if (isMoving && !this.footstepPlaying) {
      this.startFootsteps();
    } else if (!isMoving && this.footstepPlaying) {
      this.stopFootsteps();
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stopFootsteps();
  }
}
