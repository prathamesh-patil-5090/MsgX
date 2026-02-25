import { Audio, AVPlaybackStatus } from 'expo-av';
import { Platform, Vibration } from 'react-native';
import { CALL_END, OUTGOING_RING, RINGTONE } from '../assets/sounds';

// ─── Vibration Patterns ────────────────────────────────────────────────────

// Ringtone vibration: vibrate 1s, pause 1s, repeat
const RING_VIBRATION_PATTERN =
  Platform.OS === 'android' ? [0, 1000, 1000, 1000, 1000, 1000] : [0, 1000, 1000, 1000, 1000, 1000];

// Single short vibration for call events
const SHORT_VIBRATION = 200;

// ─── Audio Service ─────────────────────────────────────────────────────────

class AudioService {
  private ringtoneSound: Audio.Sound | null = null;
  private outgoingRingSound: Audio.Sound | null = null;
  private callEndSound: Audio.Sound | null = null;
  private isRingtonePlaying = false;
  private isOutgoingRingPlaying = false;
  private isVibrating = false;
  private isSpeakerOn = false;
  private audioModeConfigured = false;

  // ── Audio Mode Configuration ─────────────────────────────────────

  /**
   * Configure audio session for voice calls.
   * Call this when a call becomes active.
   */
  async configureForCall(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: true, // Start with earpiece (phone-to-ear)
      });
      this.isSpeakerOn = false;
      this.audioModeConfigured = true;
      console.log('[AudioService] Audio mode configured for call (earpiece)');
    } catch (error) {
      console.error('[AudioService] Failed to configure audio mode:', error);
    }
  }

  /**
   * Configure audio session for ringtone playback.
   * Plays through speaker at full volume.
   */
  async configureForRingtone(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false, // Play ringtone through speaker
      });
      console.log('[AudioService] Audio mode configured for ringtone (speaker)');
    } catch (error) {
      console.error('[AudioService] Failed to configure ringtone audio mode:', error);
    }
  }

  /**
   * Reset audio mode to default after call ends.
   */
  async resetAudioMode(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      this.isSpeakerOn = false;
      this.audioModeConfigured = false;
      console.log('[AudioService] Audio mode reset to default');
    } catch (error) {
      console.error('[AudioService] Failed to reset audio mode:', error);
    }
  }

  // ── Speaker Toggle ───────────────────────────────────────────────

  /**
   * Toggle between speaker and earpiece during an active call.
   * Returns the new speaker state.
   */
  async toggleSpeaker(): Promise<boolean> {
    const newSpeakerState = !this.isSpeakerOn;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: !newSpeakerState, // true = earpiece, false = speaker
      });

      this.isSpeakerOn = newSpeakerState;
      console.log(`[AudioService] Speaker ${newSpeakerState ? 'ON' : 'OFF'}`);
    } catch (error) {
      console.error('[AudioService] Failed to toggle speaker:', error);
    }

    return this.isSpeakerOn;
  }

  /**
   * Set speaker state explicitly.
   */
  async setSpeaker(enabled: boolean): Promise<void> {
    if (this.isSpeakerOn === enabled) return;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: !enabled,
      });

      this.isSpeakerOn = enabled;
      console.log(`[AudioService] Speaker set to ${enabled ? 'ON' : 'OFF'}`);
    } catch (error) {
      console.error('[AudioService] Failed to set speaker:', error);
    }
  }

  getSpeakerState(): boolean {
    return this.isSpeakerOn;
  }

  // ── Ringtone (Incoming Call) ─────────────────────────────────────

  /**
   * Start playing the ringtone for an incoming call.
   * Uses vibration + optional bundled sound file.
   */
  async startRingtone(): Promise<void> {
    if (this.isRingtonePlaying) {
      console.log('[AudioService] Ringtone already playing');
      return;
    }

    this.isRingtonePlaying = true;
    console.log('[AudioService] Starting ringtone');

    // Configure audio for ringtone (speaker mode)
    await this.configureForRingtone();

    // Start vibration pattern (repeating)
    this.startVibration();

    // Try to play sound if an asset is provided
    if (RINGTONE != null) {
      await this.loadAndPlaySound('ringtone', RINGTONE, true, 1.0);
    } else {
      console.log(
        '[AudioService] No ringtone sound file configured — vibration only.\n' +
          '  To add a ringtone: place an MP3 in assets/sounds/ringtone.mp3\n' +
          '  and uncomment the export in assets/sounds/index.ts'
      );
    }
  }

  /**
   * Stop the ringtone.
   */
  async stopRingtone(): Promise<void> {
    if (!this.isRingtonePlaying) return;

    console.log('[AudioService] Stopping ringtone');
    this.isRingtonePlaying = false;

    this.stopVibration();
    await this.unloadSound('ringtone');
  }

  // ── Outgoing Ring (Caller Waiting) ───────────────────────────────

  /**
   * Play a subtle outgoing ring/dial tone for the caller while waiting.
   */
  async startOutgoingRing(): Promise<void> {
    if (this.isOutgoingRingPlaying) return;
    this.isOutgoingRingPlaying = true;

    if (OUTGOING_RING != null) {
      await this.loadAndPlaySound('outgoingRing', OUTGOING_RING, true, 0.5);
    } else {
      console.log('[AudioService] No outgoing ring file — caller waits silently');
    }
  }

  async stopOutgoingRing(): Promise<void> {
    if (!this.isOutgoingRingPlaying) return;
    this.isOutgoingRingPlaying = false;
    await this.unloadSound('outgoingRing');
  }

  // ── Call End Sound ───────────────────────────────────────────────

  /**
   * Play a short "call ended" sound.
   */
  async playCallEndSound(): Promise<void> {
    if (CALL_END != null) {
      await this.loadAndPlaySound('callEnd', CALL_END, false, 0.7);
      // Auto-cleanup after playback finishes (non-looping)
      setTimeout(() => this.unloadSound('callEnd'), 3000);
    }
  }

  // ── Vibration ────────────────────────────────────────────────────

  private startVibration(): void {
    if (this.isVibrating) return;
    this.isVibrating = true;

    try {
      Vibration.vibrate(RING_VIBRATION_PATTERN, true);
      console.log('[AudioService] Vibration started');
    } catch (error) {
      console.error('[AudioService] Vibration error:', error);
    }
  }

  private stopVibration(): void {
    if (!this.isVibrating) return;
    this.isVibrating = false;

    try {
      Vibration.cancel();
      console.log('[AudioService] Vibration stopped');
    } catch (error) {
      console.error('[AudioService] Error stopping vibration:', error);
    }
  }

  /**
   * Single short vibration for events (call ended, rejected, etc.)
   */
  vibrateShort(): void {
    try {
      Vibration.vibrate(SHORT_VIBRATION);
    } catch (_e) {
      /* ignore */
    }
  }

  // ── Sound Helpers ────────────────────────────────────────────────

  /**
   * Unified sound loader. Loads a module asset and plays it.
   */
  private async loadAndPlaySound(
    slot: 'ringtone' | 'outgoingRing' | 'callEnd',
    asset: number,
    isLooping: boolean,
    volume: number
  ): Promise<void> {
    try {
      // Unload existing sound in this slot first
      await this.unloadSound(slot);

      const { sound } = await Audio.Sound.createAsync(asset, {
        isLooping,
        volume,
        shouldPlay: true,
      });

      // Store reference by slot
      if (slot === 'ringtone') {
        this.ringtoneSound = sound;
      } else if (slot === 'outgoingRing') {
        this.outgoingRingSound = sound;
      } else if (slot === 'callEnd') {
        this.callEndSound = sound;
      }

      // Safety: if looping and playback finishes unexpectedly, restart
      if (isLooping) {
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (status.isLoaded && status.didJustFinish && !status.isLooping) {
            sound.replayAsync().catch(() => {});
          }
        });
      }

      console.log(`[AudioService] Sound "${slot}" loaded and playing (loop=${isLooping})`);
    } catch (error) {
      console.warn(`[AudioService] Could not play sound "${slot}":`, error);
    }
  }

  /**
   * Unload a sound by slot name.
   */
  private async unloadSound(slot: 'ringtone' | 'outgoingRing' | 'callEnd'): Promise<void> {
    let sound: Audio.Sound | null = null;

    if (slot === 'ringtone') {
      sound = this.ringtoneSound;
      this.ringtoneSound = null;
    } else if (slot === 'outgoingRing') {
      sound = this.outgoingRingSound;
      this.outgoingRingSound = null;
    } else if (slot === 'callEnd') {
      sound = this.callEndSound;
      this.callEndSound = null;
    }

    if (sound) {
      try {
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          await sound.stopAsync();
          await sound.unloadAsync();
        }
      } catch (_e) {
        // Already unloaded or disposed
      }
    }
  }

  // ── Full Cleanup ─────────────────────────────────────────────────

  /**
   * Stop everything and reset. Called when a call fully ends.
   */
  async cleanup(): Promise<void> {
    await this.stopRingtone();
    await this.stopOutgoingRing();
    await this.unloadSound('callEnd');
    await this.resetAudioMode();
    console.log('[AudioService] Full cleanup done');
  }
}

// Singleton export
export const audioService = new AudioService();
