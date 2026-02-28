import { Audio, AVPlaybackStatus } from 'expo-av';
import InCallManager from 'react-native-incall-manager';
import { NativeModules, NativeEventEmitter, Platform, Vibration } from 'react-native';
import { CALL_END, OUTGOING_RING, RINGTONE } from '../assets/sounds';

const RNInCallManager = NativeModules.InCallManager;
const InCallManagerEmitter = RNInCallManager ? new NativeEventEmitter(RNInCallManager) : null;

const RING_VIBRATION_PATTERN =
  Platform.OS === 'android' ? [0, 1000, 1000, 1000, 1000, 1000] : [0, 1000, 1000, 1000, 1000, 1000];

const SHORT_VIBRATION = 200;
const BT_DETECTION_DELAY_MS = 2000;

export type AudioOutputRoute = 'earpiece' | 'speaker' | 'bluetooth';
export type AudioRouteListener = (route: AudioOutputRoute) => void;

interface AudioDeviceStatus {
  availableAudioDeviceList: string;
  selectedAudioDevice: string;
}

class AudioService {
  private ringtoneSound: Audio.Sound | null = null;
  private outgoingRingSound: Audio.Sound | null = null;
  private callEndSound: Audio.Sound | null = null;
  private isRingtonePlaying = false;
  private isOutgoingRingPlaying = false;
  private isVibrating = false;
  private audioModeConfigured = false;
  private currentRoute: AudioOutputRoute = 'earpiece';
  private bluetoothAvailable = false;
  private routeListeners: Set<AudioRouteListener> = new Set();
  private inCallManagerStarted = false;
  private btDetectionTimer: ReturnType<typeof setTimeout> | null = null;

  /* ===================================================================
   * CONSTRUCTOR
   *
   * Sets up a persistent NativeEventEmitter listener for audio device
   * changes. This listener is registered ONCE and never removed,
   * because the native InCallManager module does not implement
   * addListener/removeListeners — re-subscribing after removal
   * breaks event delivery on subsequent calls.
   * =================================================================== */

  constructor() {
    this.setupPersistentEventListener();
  }

  private setupPersistentEventListener(): void {
    if (!InCallManagerEmitter) return;
    try {
      InCallManagerEmitter.addListener('onAudioDeviceChanged', (data: AudioDeviceStatus) => {
        if (this.inCallManagerStarted) {
          this.handleAudioDeviceChanged(data);
        }
      });
    } catch (_e) {}
  }

  /* ===================================================================
   * START / STOP INCALL MANAGER
   *
   * Initializes native audio session management via InCallManager.
   * Uses auto:true so the native layer automatically manages audio
   * device detection, Bluetooth SCO connections, and device switching.
   * User route selections via chooseAudioRoute() still take priority
   * over auto-routing because the native layer checks
   * userSelectedAudioDevice first.
   *
   * A delayed BT detection refresh runs 2 seconds after start because
   * the native BluetoothProfile proxy connection is asynchronous —
   * Bluetooth may not be detected in the initial query.
   * =================================================================== */

  async startInCallManager(media: 'audio' | 'video' = 'audio'): Promise<void> {
    if (this.inCallManagerStarted) return;
    try {
      InCallManager.start({ media, auto: true, ringback: '' });
      this.inCallManagerStarted = true;
      await this.refreshAvailableDevices();
      this.scheduleDelayedBtDetection();
    } catch (e) {
      console.error('[AudioService] InCallManager start failed:', e);
    }
  }

  stopInCallManager(): void {
    if (!this.inCallManagerStarted) return;
    try {
      this.cancelDelayedBtDetection();
      InCallManager.stop({ busytone: '' });
      this.inCallManagerStarted = false;
    } catch (e) {
      console.error('[AudioService] InCallManager stop failed:', e);
    }
  }

  /* ===================================================================
   * DELAYED BLUETOOTH DETECTION
   *
   * The native BluetoothProfile proxy setup is asynchronous. After
   * InCallManager.start(), the Bluetooth manager posts start() to
   * the UI thread, which then calls getBluetoothProfileProxy() whose
   * callback onServiceConnected fires later. The initial
   * refreshAvailableDevices() often misses Bluetooth because the
   * profile hasn't connected yet. This schedules a second detection
   * attempt after a delay.
   * =================================================================== */

  private scheduleDelayedBtDetection(): void {
    this.cancelDelayedBtDetection();
    this.btDetectionTimer = setTimeout(async () => {
      if (this.inCallManagerStarted) {
        await this.refreshAvailableDevices();
        this.notifyRouteListeners();
      }
    }, BT_DETECTION_DELAY_MS);
  }

  private cancelDelayedBtDetection(): void {
    if (this.btDetectionTimer) {
      clearTimeout(this.btDetectionTimer);
      this.btDetectionTimer = null;
    }
  }

  /* ===================================================================
   * HANDLE AUDIO DEVICE CHANGE
   *
   * Called when the native layer reports a change in available audio
   * devices. Parses the JSON device list and updates bluetoothAvailable.
   * If bluetooth was the active route but just disconnected, falls back
   * to earpiece automatically. Notifies UI listeners when bluetooth
   * availability changes so the toggle button updates.
   * =================================================================== */

  private handleAudioDeviceChanged(data: AudioDeviceStatus): void {
    try {
      const devices: string[] = JSON.parse(data.availableAudioDeviceList || '[]');
      const wasBtAvailable = this.bluetoothAvailable;
      this.bluetoothAvailable = devices.some((d) => d === 'BLUETOOTH');

      if (data.selectedAudioDevice) {
        const selected = data.selectedAudioDevice;
        if (selected === 'BLUETOOTH') {
          this.currentRoute = 'bluetooth';
        } else if (selected === 'SPEAKER_PHONE') {
          this.currentRoute = 'speaker';
        } else if (selected === 'EARPIECE') {
          this.currentRoute = 'earpiece';
        }
      }

      if (wasBtAvailable && !this.bluetoothAvailable && this.currentRoute === 'bluetooth') {
        this.setAudioRoute('earpiece');
        return;
      }

      this.notifyRouteListeners();
    } catch (_e) {}
  }

  /* ===================================================================
   * REFRESH AVAILABLE AUDIO DEVICES
   *
   * Actively queries the native layer for the current set of available
   * audio devices by calling chooseAudioRoute with the current route.
   * The return value includes availableAudioDeviceList which we parse
   * to update the bluetoothAvailable flag. Called once when InCallManager
   * starts and each time the user cycles the audio output.
   * =================================================================== */

  private async refreshAvailableDevices(): Promise<void> {
    if (!this.inCallManagerStarted) {
      this.bluetoothAvailable = false;
      return;
    }

    try {
      const routeMap: Record<AudioOutputRoute, string> = {
        earpiece: 'EARPIECE',
        speaker: 'SPEAKER_PHONE',
        bluetooth: 'BLUETOOTH',
      };
      const result: AudioDeviceStatus = await InCallManager.chooseAudioRoute(
        routeMap[this.currentRoute]
      );
      if (result && result.availableAudioDeviceList) {
        const devices: string[] = JSON.parse(result.availableAudioDeviceList);
        this.bluetoothAvailable = devices.some((d) => d === 'BLUETOOTH');
      }
    } catch (_e) {
      this.bluetoothAvailable = false;
    }
  }

  /* ===================================================================
   * SET AUDIO ROUTE
   *
   * Switches audio output to the specified route using InCallManager's
   * chooseAudioRoute() which accepts:
   *   "EARPIECE" | "SPEAKER_PHONE" | "BLUETOOTH" | "WIRED_HEADSET"
   * The native module handles Bluetooth SCO, speaker, and earpiece
   * switching internally including starting/stopping SCO audio.
   *
   * IMPORTANT: Does NOT call expo-av Audio.setAudioModeAsync() when
   * InCallManager is active — expo-av's setSpeakerphoneOn and setMode
   * calls conflict with InCallManager's native AudioManager control,
   * breaking Bluetooth SCO audio routing.
   * =================================================================== */

  async setAudioRoute(route: AudioOutputRoute): Promise<void> {
    try {
      if (this.inCallManagerStarted) {
        const routeMap: Record<AudioOutputRoute, string> = {
          earpiece: 'EARPIECE',
          speaker: 'SPEAKER_PHONE',
          bluetooth: 'BLUETOOTH',
        };

        const result: AudioDeviceStatus = await InCallManager.chooseAudioRoute(routeMap[route]);

        if (result && result.availableAudioDeviceList) {
          const devices: string[] = JSON.parse(result.availableAudioDeviceList);
          this.bluetoothAvailable = devices.some((d) => d === 'BLUETOOTH');
        }

        if (result && result.selectedAudioDevice) {
          const selected = result.selectedAudioDevice;
          if (selected === 'BLUETOOTH') {
            this.currentRoute = 'bluetooth';
          } else if (selected === 'SPEAKER_PHONE') {
            this.currentRoute = 'speaker';
          } else {
            this.currentRoute = 'earpiece';
          }
        } else {
          this.currentRoute = route;
        }
      } else {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: route === 'earpiece',
        });
        this.currentRoute = route;
      }

      this.notifyRouteListeners();
    } catch (error) {
      console.error('[AudioService] Failed to set audio route:', error);
    }
  }

  /* ===================================================================
   * CYCLE AUDIO OUTPUT  (3-way toggle button)
   *
   * Cycles through available audio output routes in this order:
   *   earpiece -> speaker -> bluetooth -> earpiece -> ...
   * If no bluetooth device is connected, bluetooth is skipped:
   *   earpiece -> speaker -> earpiece -> ...
   * Re-checks available devices each time it is called so newly
   * connected bluetooth devices are detected immediately.
   * Returns the new active route.
   * =================================================================== */

  async cycleAudioOutput(): Promise<AudioOutputRoute> {
    await this.refreshAvailableDevices();

    let nextRoute: AudioOutputRoute;

    if (this.bluetoothAvailable) {
      switch (this.currentRoute) {
        case 'earpiece':
          nextRoute = 'speaker';
          break;
        case 'speaker':
          nextRoute = 'bluetooth';
          break;
        case 'bluetooth':
          nextRoute = 'earpiece';
          break;
        default:
          nextRoute = 'earpiece';
      }
    } else {
      switch (this.currentRoute) {
        case 'earpiece':
          nextRoute = 'speaker';
          break;
        case 'speaker':
          nextRoute = 'earpiece';
          break;
        case 'bluetooth':
          nextRoute = 'earpiece';
          break;
        default:
          nextRoute = 'earpiece';
      }
    }

    await this.setAudioRoute(nextRoute);
    return nextRoute;
  }

  getCurrentRoute(): AudioOutputRoute {
    return this.currentRoute;
  }

  isBluetoothAvailable(): boolean {
    return this.bluetoothAvailable;
  }

  onRouteChange(listener: AudioRouteListener): () => void {
    this.routeListeners.add(listener);
    return () => {
      this.routeListeners.delete(listener);
    };
  }

  private notifyRouteListeners(): void {
    for (const listener of this.routeListeners) {
      try {
        listener(this.currentRoute);
      } catch (_e) {}
    }
  }

  getSpeakerState(): boolean {
    return this.currentRoute === 'speaker';
  }

  /* ===================================================================
   * CONFIGURE AUDIO FOR ACTIVE CALL
   *
   * Starts InCallManager which takes full control of native audio:
   *   - Sets AudioManager mode to MODE_IN_COMMUNICATION
   *   - Manages Bluetooth SCO connections automatically
   *   - Monitors audio device connect/disconnect events
   *
   * CRITICAL: Does NOT call expo-av Audio.setAudioModeAsync() after
   * starting InCallManager. expo-av calls audioManager.setSpeakerphoneOn()
   * and audioManager.setMode() which OVERRIDE InCallManager's native
   * audio configuration, breaking Bluetooth SCO audio routing.
   * The initial audio route is set via chooseAudioRoute() which works
   * within InCallManager's managed audio session.
   * =================================================================== */

  async configureForCall(isVideoCall: boolean = false): Promise<void> {
    try {
      await this.startInCallManager(isVideoCall ? 'video' : 'audio');

      const defaultRoute: AudioOutputRoute = isVideoCall ? 'speaker' : 'earpiece';
      await this.setAudioRoute(defaultRoute);
      this.audioModeConfigured = true;
    } catch (error) {
      console.error('[AudioService] Failed to configure audio mode:', error);
    }
  }

  /* ===================================================================
   * CONFIGURE AUDIO FOR RINGTONE
   *
   * Routes audio through the loudspeaker so the incoming-call ringtone
   * is clearly audible even when the phone is on a table.
   * This uses expo-av since InCallManager is NOT active during ringing.
   * =================================================================== */

  async configureForRingtone(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('[AudioService] Failed to configure ringtone audio mode:', error);
    }
  }

  /* ===================================================================
   * RESET AUDIO MODE
   *
   * Restores audio to the default system configuration after a call
   * ends. Stops InCallManager (which tears down Bluetooth SCO and
   * releases audio focus), resets expo-av, and clears route state.
   * The persistent NativeEventEmitter listener is kept alive so it
   * works correctly for the next call without re-subscribing.
   * =================================================================== */

  async resetAudioMode(): Promise<void> {
    try {
      this.stopInCallManager();

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      this.currentRoute = 'earpiece';
      this.bluetoothAvailable = false;
      this.audioModeConfigured = false;
      this.notifyRouteListeners();
    } catch (error) {
      console.error('[AudioService] Failed to reset audio mode:', error);
    }
  }

  async toggleSpeaker(): Promise<boolean> {
    if (this.currentRoute === 'speaker') {
      await this.setAudioRoute('earpiece');
      return false;
    } else {
      await this.setAudioRoute('speaker');
      return true;
    }
  }

  async setSpeaker(enabled: boolean): Promise<void> {
    await this.setAudioRoute(enabled ? 'speaker' : 'earpiece');
  }

  /* ===================================================================
   * START / STOP RINGTONE
   *
   * Plays the bundled incoming-call ringtone in a loop with vibration.
   * Configures audio for speaker output first so it is heard aloud.
   * =================================================================== */

  async startRingtone(): Promise<void> {
    if (this.isRingtonePlaying) return;
    this.isRingtonePlaying = true;

    await this.configureForRingtone();
    this.startVibration();

    if (RINGTONE != null) {
      await this.loadAndPlaySound('ringtone', RINGTONE, true, 1.0);
    }
  }

  async stopRingtone(): Promise<void> {
    if (!this.isRingtonePlaying) return;
    this.isRingtonePlaying = false;
    this.stopVibration();
    await this.unloadSound('ringtone');
  }

  /* ===================================================================
   * OUTGOING RING (dial tone)
   *
   * Plays a subtle looping dial tone for the caller while waiting
   * for the other party to answer.
   * =================================================================== */

  async startOutgoingRing(): Promise<void> {
    if (this.isOutgoingRingPlaying) return;
    this.isOutgoingRingPlaying = true;

    if (OUTGOING_RING != null) {
      await this.loadAndPlaySound('outgoingRing', OUTGOING_RING, true, 0.5);
    }
  }

  async stopOutgoingRing(): Promise<void> {
    if (!this.isOutgoingRingPlaying) return;
    this.isOutgoingRingPlaying = false;
    await this.unloadSound('outgoingRing');
  }

  /* ===================================================================
   * CALL-END SOUND
   *
   * Plays a short beep/tone when a call ends. The sound resource is
   * automatically unloaded after 3 seconds.
   * =================================================================== */

  async playCallEndSound(): Promise<void> {
    if (CALL_END != null) {
      await this.loadAndPlaySound('callEnd', CALL_END, false, 0.7);
      setTimeout(() => this.unloadSound('callEnd'), 3000);
    }
  }

  private startVibration(): void {
    if (this.isVibrating) return;
    this.isVibrating = true;
    try {
      Vibration.vibrate(RING_VIBRATION_PATTERN, true);
    } catch (_e) {}
  }

  private stopVibration(): void {
    if (!this.isVibrating) return;
    this.isVibrating = false;
    try {
      Vibration.cancel();
    } catch (_e) {}
  }

  vibrateShort(): void {
    try {
      Vibration.vibrate(SHORT_VIBRATION);
    } catch (_e) {}
  }

  /* ===================================================================
   * LOAD AND PLAY SOUND
   *
   * Generic helper that loads a bundled audio asset into one of the
   * named slots (ringtone, outgoingRing, callEnd) and starts playback.
   * Supports looping and per-slot volume control.
   * =================================================================== */

  private async loadAndPlaySound(
    slot: 'ringtone' | 'outgoingRing' | 'callEnd',
    asset: number,
    isLooping: boolean,
    volume: number
  ): Promise<void> {
    try {
      await this.unloadSound(slot);

      const { sound } = await Audio.Sound.createAsync(asset, {
        isLooping,
        volume,
        shouldPlay: true,
      });

      if (slot === 'ringtone') {
        this.ringtoneSound = sound;
      } else if (slot === 'outgoingRing') {
        this.outgoingRingSound = sound;
      } else if (slot === 'callEnd') {
        this.callEndSound = sound;
      }

      if (isLooping) {
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (status.isLoaded && status.didJustFinish && !status.isLooping) {
            sound.replayAsync().catch(() => {});
          }
        });
      }
    } catch (error) {
      console.warn(`[AudioService] Could not play sound "${slot}":`, error);
    }
  }

  /* ===================================================================
   * UNLOAD SOUND
   *
   * Stops and unloads a previously loaded sound from the given slot.
   * Safely handles already-unloaded or never-loaded slots.
   * =================================================================== */

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
      } catch (_e) {}
    }
  }

  /* ===================================================================
   * FULL CLEANUP
   *
   * Stops every active sound, cancels vibration, and resets all audio
   * routing back to system defaults. Called when a call fully ends.
   * =================================================================== */

  async cleanup(): Promise<void> {
    await this.stopRingtone();
    await this.stopOutgoingRing();
    await this.unloadSound('callEnd');
    await this.resetAudioMode();
  }
}

export const audioService = new AudioService();
