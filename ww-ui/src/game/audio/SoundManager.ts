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
/**
 * Configuration for spatial audio playback
 */
interface SpatialConfig {
  /** Maximum distance at which the sound is still audible */
  maxDistance?: number;
  /** Distance at which the sound starts to fade (default: 0) */
  minDistance?: number;
}

export class SoundManager {
  private scene: Scene;
  private masterVolume: number = 0.5;
  private soundEnabled: boolean = true;
  private footstepPlaying: boolean = false;
  private footstepInterval: number | null = null;

  /** Multiplier applied to viewport diagonal for max audible distance (1.0 = screen corner) */
  private readonly VIEWPORT_DISTANCE_MULTIPLIER = 1.0;

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
   * Calculate the viewport radius (distance from center to corner of the camera view)
   */
  private getViewportRadius(): number {
    const camera = this.scene.cameras.main;
    if (!camera) return 400; // Fallback default

    // Use half the diagonal of the viewport as the base radius
    return Math.sqrt(
      Math.pow(camera.width / 2, 2) + Math.pow(camera.height / 2, 2)
    );
  }

  /**
   * Play a sound effect at a specific world position.
   * The volume will be adjusted based on distance from the camera center (player's view).
   * Sounds outside the viewport radius (with multiplier) will not play at all.
   *
   * @param soundKey - The sound to play
   * @param worldX - X position in world coordinates where the sound originates
   * @param worldY - Y position in world coordinates where the sound originates
   * @param spatialConfig - Optional configuration for distance falloff
   * @param configOverride - Optional sound config overrides
   */
  public playAtPosition(
    soundKey: SoundKey,
    worldX: number,
    worldY: number,
    spatialConfig?: SpatialConfig,
    configOverride?: SoundConfig
  ): void {
    if (!this.soundEnabled) return;

    const camera = this.scene.cameras.main;
    if (!camera) {
      // Fallback to regular play if no camera
      this.play(soundKey, configOverride);
      return;
    }

    // Get the center of the camera (player's view center)
    const cameraX = camera.scrollX + camera.width / 2;
    const cameraY = camera.scrollY + camera.height / 2;

    // Calculate distance from camera center to sound position
    const distance = Phaser.Math.Distance.Between(
      cameraX,
      cameraY,
      worldX,
      worldY
    );

    // Default max distance is based on viewport radius
    const viewportRadius = this.getViewportRadius();
    const maxDistance =
      spatialConfig?.maxDistance ??
      viewportRadius * this.VIEWPORT_DISTANCE_MULTIPLIER;
    const minDistance = spatialConfig?.minDistance ?? 0;

    // Don't play if outside max distance
    if (distance > maxDistance) {
      return;
    }

    // Calculate volume falloff (1.0 at minDistance, 0.0 at maxDistance)
    let volumeMultiplier = 1.0;
    if (distance > minDistance) {
      const falloffRange = maxDistance - minDistance;
      const falloffDistance = distance - minDistance;
      volumeMultiplier = 1 - falloffDistance / falloffRange;
    }

    // Apply volume multiplier via config override
    const config = { ...this.soundConfigs[soundKey], ...configOverride };
    const adjustedVolume = (config.volume ?? 1) * volumeMultiplier;

    this.play(soundKey, { ...configOverride, volume: adjustedVolume });
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
