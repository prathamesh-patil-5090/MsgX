// @ts-ignore -- installed at runtime
import { Device, types as mediasoupTypes } from 'mediasoup-client';
// @ts-ignore -- installed at runtime
import { mediaDevices, MediaStream, registerGlobals } from 'react-native-webrtc';
// @ts-ignore -- installed at runtime
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './loginApi';

// Register WebRTC globals so mediasoup-client can find them
registerGlobals();

// ─── Types ─────────────────────────────────────────────────────────────────

export type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'ended'
  | 'rejected'
  | 'missed'
  | 'error';

export interface CallState {
  status: CallStatus;
  callId: string | null;
  remoteUserId: number | null;
  remoteUserName: string | null;
  conversationId: string | null;
  isCaller: boolean;
  isMuted: boolean;
  isPeerMuted: boolean;
  duration: number;
  error: string | null;
}

export interface IncomingCallData {
  callId: string;
  callerId: number;
  callerName: string;
  conversationId: string | null;
}

export type CallEventListener = (state: CallState) => void;
export type IncomingCallListener = (data: IncomingCallData) => void;

const VOICE_SERVER_URL = process.env.EXPO_PUBLIC_VOICE_SERVER_URL || 'http://localhost:3001';

// ─── Service ───────────────────────────────────────────────────────────────

class VoiceCallService {
  private socket: Socket | null = null;
  private device: Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private producer: mediasoupTypes.Producer | null = null;
  private consumer: mediasoupTypes.Consumer | null = null;
  private localStream: MediaStream | null = null;

  private callState: CallState = this.getDefaultState();
  private callEventListeners: Set<CallEventListener> = new Set();
  private incomingCallListeners: Set<IncomingCallListener> = new Set();
  private durationInterval: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private listenersSetup = false;

  // ── Default State ──────────────────────────────────────────────────

  private getDefaultState(): CallState {
    return {
      status: 'idle',
      callId: null,
      remoteUserId: null,
      remoteUserName: null,
      conversationId: null,
      isCaller: false,
      isMuted: false,
      isPeerMuted: false,
      duration: 0,
      error: null,
    };
  }

  // ── State Management ───────────────────────────────────────────────

  private updateState(partial: Partial<CallState>) {
    this.callState = { ...this.callState, ...partial };
    this.notifyListeners();
  }

  private notifyListeners() {
    for (const listener of this.callEventListeners) {
      try {
        listener({ ...this.callState });
      } catch (e) {
        console.error('[VoiceCall] Listener error:', e);
      }
    }
  }

  getState(): CallState {
    return { ...this.callState };
  }

  // ── Event Subscriptions ────────────────────────────────────────────

  onCallStateChange(listener: CallEventListener): () => void {
    this.callEventListeners.add(listener);
    return () => {
      this.callEventListeners.delete(listener);
    };
  }

  onIncomingCall(listener: IncomingCallListener): () => void {
    this.incomingCallListeners.add(listener);
    return () => {
      this.incomingCallListeners.delete(listener);
    };
  }

  // ── Socket Connection ──────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.socket?.connected) {
      console.log('[VoiceCall] Already connected');
      return;
    }

    // If socket exists but is disconnected, try to reconnect it first
    if (this.socket && !this.socket.connected) {
      console.log('[VoiceCall] Socket exists but disconnected — attempting reconnect...');
      try {
        this.socket.connect();
        // Wait briefly for reconnect
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Reconnect timeout'));
          }, 5000);

          this.socket!.once('connect', () => {
            clearTimeout(timeout);
            console.log('[VoiceCall] Reconnected to voice server');
            resolve();
          });

          this.socket!.once('connect_error', (err: Error) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
        return; // Reconnected successfully, listeners are still attached
      } catch (reconnectError) {
        console.warn('[VoiceCall] Reconnect failed, creating fresh connection:', reconnectError);
        // Fall through to create a new socket below
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
        this.listenersSetup = false;
      }
    }

    if (this.isConnecting) {
      console.log('[VoiceCall] Already connecting...');
      // Wait for existing connection attempt
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.isConnecting) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        // Safety timeout
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 12000);
      });
      return;
    }

    this.isConnecting = true;

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('No access token available');
      }

      console.log('[VoiceCall] Connecting to voice server:', VOICE_SERVER_URL);

      // Clean up any existing socket (safety net — should be null by now)
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
        this.listenersSetup = false;
      }

      this.socket = io(VOICE_SERVER_URL, {
        query: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 10000,
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.socket!.once('connect', () => {
          clearTimeout(timeout);
          console.log('[VoiceCall] Connected to voice server');
          resolve();
        });

        this.socket!.once('connect_error', (error: Error) => {
          clearTimeout(timeout);
          console.error('[VoiceCall] Connection error:', error.message);
          reject(error);
        });
      });

      this.setupSocketListeners();
    } catch (error) {
      console.error('[VoiceCall] Failed to connect:', error);
      this.socket?.disconnect();
      this.socket = null;
      this.listenersSetup = false;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private setupSocketListeners() {
    if (!this.socket || this.listenersSetup) return;
    this.listenersSetup = true;

    // ── Incoming call ────────────────────────────────────────────
    this.socket.on('call:incoming', (data: IncomingCallData) => {
      console.log('[VoiceCall] Incoming call:', data);

      // If already in a call, auto-reject
      if (this.callState.status === 'active' || this.callState.status === 'connecting') {
        console.log('[VoiceCall] Auto-rejecting, already in a call');
        this.socket?.emit('call:reject', { callId: data.callId });
        return;
      }

      // If we're in a ringing state as a caller, also reject incoming
      if (this.callState.status === 'ringing' && this.callState.isCaller) {
        console.log('[VoiceCall] Auto-rejecting, currently calling someone');
        this.socket?.emit('call:reject', { callId: data.callId });
        return;
      }

      this.updateState({
        status: 'ringing',
        callId: data.callId,
        remoteUserId: data.callerId,
        remoteUserName: data.callerName,
        conversationId: data.conversationId,
        isCaller: false,
        error: null,
      });

      for (const listener of this.incomingCallListeners) {
        try {
          listener(data);
        } catch (e) {
          console.error('[VoiceCall] Incoming call listener error:', e);
        }
      }
    });

    // ── Call accepted (caller receives this) ─────────────────────
    this.socket.on('call:accepted', async (data: { callId: string }) => {
      console.log('[VoiceCall] Call accepted:', data.callId);

      if (this.callState.callId !== data.callId) {
        console.warn('[VoiceCall] Received accepted for unknown call:', data.callId);
        return;
      }

      this.updateState({ status: 'active' });
      this.startDurationTimer();

      // Start mediasoup flow with retry
      try {
        await this.setupMediasoupWithRetry();
        console.log('[VoiceCall] Caller mediasoup setup complete');
      } catch (error) {
        console.error('[VoiceCall] Caller mediasoup setup failed after retries:', error);
        this.updateState({
          status: 'error',
          error: 'Failed to setup audio connection',
        });
        // Await endCall to ensure server cleanup
        await this.endCall().catch((e) =>
          console.error('[VoiceCall] Error ending call after setup failure:', e)
        );
      }
    });

    // ── Call rejected ────────────────────────────────────────────
    this.socket.on('call:rejected', (data: { callId: string }) => {
      console.log('[VoiceCall] Call rejected:', data.callId);
      this.updateState({ status: 'rejected' });
      this.cleanupCall();

      setTimeout(() => {
        this.resetState();
      }, 2000);
    });

    // ── Call ended ───────────────────────────────────────────────
    this.socket.on(
      'call:ended',
      (data: { callId: string; endedBy: number | string; reason?: string }) => {
        console.log('[VoiceCall] Call ended:', data);
        this.updateState({ status: 'ended' });
        this.cleanupCall();

        setTimeout(() => {
          this.resetState();
        }, 1500);
      }
    );

    // ── Call timeout ─────────────────────────────────────────────
    this.socket.on('call:timeout', (data: { callId: string }) => {
      console.log('[VoiceCall] Call timed out:', data.callId);
      this.updateState({ status: 'missed' });
      this.cleanupCall();

      setTimeout(() => {
        this.resetState();
      }, 2000);
    });

    // ── New producer available (other user started streaming) ─────
    this.socket.on(
      'call:newProducer',
      async (data: { callId: string; producerId: string; producerUserId: number }) => {
        console.log('[VoiceCall] New producer from peer:', data.producerId);

        if (this.callState.status !== 'active') {
          console.warn('[VoiceCall] Ignoring newProducer — not in active call');
          return;
        }

        try {
          await this.consumeAudio(data.callId, data.producerId);
        } catch (error) {
          console.error('[VoiceCall] Failed to consume audio:', error);
          // Don't end the call just because consuming failed — retry on next producer event
        }
      }
    );

    // ── Peer mute changed ────────────────────────────────────────
    this.socket.on(
      'call:peerMuteChanged',
      (data: { callId: string; userId: number; isMuted: boolean }) => {
        console.log('[VoiceCall] Peer mute changed:', data.isMuted);
        this.updateState({ isPeerMuted: data.isMuted });
      }
    );

    // ── Socket disconnect ────────────────────────────────────────
    this.socket.on('disconnect', (reason: string) => {
      console.log('[VoiceCall] Socket disconnected:', reason);

      if (this.callState.status === 'active' || this.callState.status === 'ringing') {
        this.updateState({
          status: 'ended',
          error: 'Connection lost',
        });
        this.cleanupCall();
        setTimeout(() => this.resetState(), 2000);
      }

      // If the server kicked us (not a client-initiated disconnect),
      // the socket.io client will auto-reconnect via its built-in logic.
      // We just need to make sure we re-register on the next 'connect'.
    });

    // ── Socket reconnect (fires on the SAME socket instance after auto-reconnect) ──
    this.socket.on('connect', () => {
      // This fires both on initial connect AND on every reconnect.
      // On initial connect, setupSocketListeners hasn't run yet so this is a no-op.
      // On reconnect, we just log — the listeners are still attached to this socket.
      console.log('[VoiceCall] Socket (re)connected, id:', this.socket?.id);
    });
  }

  // ── Mediasoup Setup (with retry) ───────────────────────────────────

  private async setupMediasoupWithRetry(maxRetries: number = 2): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[VoiceCall] Mediasoup setup attempt ${attempt}/${maxRetries}`);
        await this.setupMediasoup();
        console.log(`[VoiceCall] Mediasoup setup succeeded on attempt ${attempt}`);
        return;
      } catch (error: any) {
        lastError = error;
        console.error(`[VoiceCall] Mediasoup setup attempt ${attempt} failed:`, error.message);

        // Clean up partial state before retry
        this.cleanupMediasoup();

        // If the call is no longer active (someone ended it), don't retry
        if (this.callState.status !== 'active') {
          console.log('[VoiceCall] Call no longer active, aborting mediasoup setup');
          throw error;
        }

        if (attempt < maxRetries) {
          console.log(`[VoiceCall] Retrying mediasoup setup in 1 second...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    throw lastError || new Error('Mediasoup setup failed after retries');
  }

  private async setupMediasoup(): Promise<void> {
    if (!this.socket || !this.callState.callId) {
      throw new Error('No socket connection or call ID');
    }

    const callId = this.callState.callId;

    // 1. Get router RTP capabilities
    console.log('[VoiceCall] Getting router RTP capabilities...');
    const { rtpCapabilities, error: rtpError } = await this.emitAsync(
      'getRouterRtpCapabilities',
      {}
    );

    if (rtpError) {
      throw new Error(`Failed to get RTP capabilities: ${rtpError}`);
    }

    if (!rtpCapabilities) {
      throw new Error('No RTP capabilities received from router');
    }

    // 2. Create mediasoup Device and load capabilities
    this.device = new Device();

    await this.device.load({
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log('[VoiceCall] Device loaded with RTP capabilities');

    // Check call is still active
    if (this.callState.status !== 'active') {
      throw new Error('Call ended during setup');
    }

    // 3. Create send transport
    await this.createSendTransport(callId);
    console.log('[VoiceCall] Send transport ready');

    // Check call is still active
    if (this.callState.status !== 'active') {
      throw new Error('Call ended during setup');
    }

    // 4. Create recv transport
    await this.createRecvTransport(callId);
    console.log('[VoiceCall] Recv transport ready');

    // Check call is still active
    if (this.callState.status !== 'active') {
      throw new Error('Call ended during setup');
    }

    // 5. Produce audio
    await this.produceAudio(callId);
    console.log('[VoiceCall] Audio producing');
  }

  private async createSendTransport(callId: string): Promise<void> {
    const transportData = await this.emitAsync('createTransport', {
      callId,
      direction: 'send',
    });

    if (transportData.error) {
      throw new Error(`createTransport (send) failed: ${transportData.error}`);
    }

    this.sendTransport = this.device!.createSendTransport({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
    });

    this.sendTransport.on(
      'connect',
      ({ dtlsParameters }: any, callback: () => void, errback: (err: Error) => void) => {
        this.emitAsync('connectTransport', {
          callId,
          direction: 'send',
          dtlsParameters,
        })
          .then(() => callback())
          .catch(errback);
      }
    );

    this.sendTransport.on(
      'produce',
      async (
        { kind, rtpParameters }: any,
        callback: (arg: { id: string }) => void,
        errback: (err: Error) => void
      ) => {
        try {
          const result = await this.emitAsync('produce', {
            callId,
            kind,
            rtpParameters,
          });
          if (result.error) {
            errback(new Error(result.error));
          } else {
            callback({ id: result.id });
          }
        } catch (error: any) {
          errback(error);
        }
      }
    );

    this.sendTransport.on('connectionstatechange', (state: string) => {
      console.log(`[VoiceCall] Send transport connection state: ${state}`);
      if (state === 'failed' || state === 'closed') {
        console.warn('[VoiceCall] Send transport failed/closed');
      }
    });

    console.log('[VoiceCall] Send transport created');
  }

  private async createRecvTransport(callId: string): Promise<void> {
    const transportData = await this.emitAsync('createTransport', {
      callId,
      direction: 'recv',
    });

    if (transportData.error) {
      throw new Error(`createTransport (recv) failed: ${transportData.error}`);
    }

    this.recvTransport = this.device!.createRecvTransport({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
    });

    this.recvTransport.on(
      'connect',
      ({ dtlsParameters }: any, callback: () => void, errback: (err: Error) => void) => {
        this.emitAsync('connectTransport', {
          callId,
          direction: 'recv',
          dtlsParameters,
        })
          .then(() => callback())
          .catch(errback);
      }
    );

    this.recvTransport.on('connectionstatechange', (state: string) => {
      console.log(`[VoiceCall] Recv transport connection state: ${state}`);
      if (state === 'failed' || state === 'closed') {
        console.warn('[VoiceCall] Recv transport failed/closed');
      }
    });

    console.log('[VoiceCall] Recv transport created');
  }

  private async produceAudio(callId: string): Promise<void> {
    try {
      // Get microphone stream
      console.log('[VoiceCall] Requesting microphone access...');
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.localStream = stream as MediaStream;

      const audioTrack = (this.localStream as any).getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No audio track available');
      }

      console.log('[VoiceCall] Got audio track, producing...');

      this.producer = await this.sendTransport!.produce({
        track: audioTrack,
        codecOptions: {
          opusStereo: false,
          opusDtx: true,
        },
      });

      this.producer.on('trackended', () => {
        console.log('[VoiceCall] Audio track ended');
      });

      this.producer.on('transportclose', () => {
        console.log('[VoiceCall] Producer transport closed');
        this.producer = null;
      });

      console.log('[VoiceCall] Audio producer created');
    } catch (error) {
      console.error('[VoiceCall] Failed to produce audio:', error);
      throw error;
    }
  }

  private async consumeAudio(callId: string, producerId: string): Promise<void> {
    if (!this.device || !this.recvTransport) {
      console.warn('[VoiceCall] Cannot consume: device or recv transport not ready');
      return;
    }

    console.log(`[VoiceCall] Consuming producer ${producerId}...`);

    const consumerData = await this.emitAsync('consume', {
      callId,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    if (consumerData.error) {
      throw new Error(`consume failed: ${consumerData.error}`);
    }

    this.consumer = await this.recvTransport.consume({
      id: consumerData.id,
      producerId: consumerData.producerId,
      kind: consumerData.kind,
      rtpParameters: consumerData.rtpParameters,
    });

    // Resume the consumer
    const resumeResult = await this.emitAsync('resumeConsumer', {
      callId,
      consumerId: this.consumer.id,
    });

    if (resumeResult.error) {
      console.warn('[VoiceCall] Resume consumer warning:', resumeResult.error);
    }

    console.log('[VoiceCall] Audio consumer created and resumed');
  }

  // ── Call Actions ───────────────────────────────────────────────────

  async initiateCall(calleeId: number, callerName: string, conversationId?: string): Promise<void> {
    try {
      // Ensure connected
      await this.connect();

      // If not idle, try to clean up first
      if (
        this.callState.status !== 'idle' &&
        this.callState.status !== 'ended' &&
        this.callState.status !== 'rejected' &&
        this.callState.status !== 'missed' &&
        this.callState.status !== 'error'
      ) {
        throw new Error('Already in a call');
      }

      // Force cleanup stale state before a new call — both locally and on the server
      this.cleanupCall();
      this.resetStateSync();

      // Ask server to clean up any stale calls for this user
      try {
        const cleanupResult = await this.emitAsync('call:forceCleanup', {});
        if (cleanupResult.cleaned > 0) {
          console.log(`[VoiceCall] Server cleaned up ${cleanupResult.cleaned} stale call(s)`);
        }
      } catch (e) {
        console.warn('[VoiceCall] Force cleanup failed (non-fatal):', e);
      }

      this.updateState({
        status: 'connecting',
        remoteUserId: calleeId,
        remoteUserName: null,
        conversationId: conversationId || null,
        isCaller: true,
        error: null,
        isMuted: false,
        isPeerMuted: false,
        duration: 0,
      });

      const result = await this.emitAsync('call:initiate', {
        calleeId,
        callerName,
        conversationId,
      });

      if (result.error) {
        this.updateState({ status: 'error', error: result.error });
        setTimeout(() => this.resetState(), 2500);
        throw new Error(result.error);
      }

      this.updateState({
        status: 'ringing',
        callId: result.callId,
      });

      console.log('[VoiceCall] Call initiated:', result.callId);
    } catch (error: any) {
      console.error('[VoiceCall] Failed to initiate call:', error);
      if (this.callState.status === 'connecting') {
        this.updateState({
          status: 'error',
          error: error.message || 'Failed to start call',
        });
        setTimeout(() => this.resetState(), 2500);
      }
      throw error;
    }
  }

  async acceptCall(): Promise<void> {
    if (!this.callState.callId || this.callState.status !== 'ringing') {
      console.warn('[VoiceCall] No ringing call to accept');
      return;
    }

    const callId = this.callState.callId;

    try {
      const result = await this.emitAsync('call:accept', {
        callId,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      this.updateState({ status: 'active' });
      this.startDurationTimer();

      // Start mediasoup flow with retry
      await this.setupMediasoupWithRetry();

      console.log('[VoiceCall] Call accepted and media setup complete');
    } catch (error: any) {
      console.error('[VoiceCall] Failed to accept call:', error);
      this.updateState({
        status: 'error',
        error: 'Failed to connect audio',
      });
      // Await endCall so server-side cleanup actually happens
      await this.endCall().catch((e) =>
        console.error('[VoiceCall] Error ending call after accept failure:', e)
      );
    }
  }

  async rejectCall(): Promise<void> {
    if (!this.callState.callId) {
      console.warn('[VoiceCall] No call to reject');
      this.resetState();
      return;
    }

    try {
      await this.emitAsync('call:reject', {
        callId: this.callState.callId,
      });
    } catch (error) {
      console.error('[VoiceCall] Error rejecting call:', error);
    }

    this.updateState({ status: 'rejected' });
    this.cleanupCall();
    setTimeout(() => this.resetState(), 1000);
  }

  async endCall(): Promise<void> {
    const callId = this.callState.callId;

    if (!callId) {
      this.cleanupCall();
      this.resetState();
      return;
    }

    // Immediately update local state so UI reflects "ended"
    this.updateState({ status: 'ended' });
    this.cleanupCall();

    // Notify server (best-effort, don't block on failure)
    try {
      await this.emitAsync('call:end', { callId });
      console.log('[VoiceCall] Server acknowledged call:end for', callId);
    } catch (error) {
      console.error('[VoiceCall] Error notifying server of call:end:', error);
      // If emit failed, try direct fire-and-forget as fallback
      try {
        this.socket?.emit('call:end', { callId });
      } catch (_e) {
        /* last resort, ignore */
      }
    }

    setTimeout(() => this.resetState(), 1000);
  }

  toggleMute(): void {
    if (this.callState.status !== 'active') return;

    const newMuted = !this.callState.isMuted;
    this.updateState({ isMuted: newMuted });

    // Pause/resume the producer
    if (this.producer) {
      if (newMuted) {
        this.producer.pause();
      } else {
        this.producer.resume();
      }
    }

    // Notify the server
    if (this.socket && this.callState.callId) {
      this.socket.emit('call:toggleMute', {
        callId: this.callState.callId,
        isMuted: newMuted,
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private emitAsync(event: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        return reject(new Error('Socket not connected'));
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Socket event '${event}' timed out (10s)`));
      }, 10000);

      this.socket.emit(event, data, (response: any) => {
        clearTimeout(timeout);
        resolve(response || {});
      });
    });
  }

  private startDurationTimer() {
    this.stopDurationTimer();
    this.durationInterval = setInterval(() => {
      if (this.callState.status === 'active') {
        this.updateState({ duration: this.callState.duration + 1 });
      }
    }, 1000);
  }

  private stopDurationTimer() {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  /**
   * Clean up only mediasoup-related resources (transports, producer, consumer)
   * without touching call state. Used for retry scenarios.
   */
  private cleanupMediasoup() {
    try {
      if (this.producer) {
        this.producer.close();
        this.producer = null;
      }
    } catch {
      this.producer = null;
    }

    try {
      if (this.consumer) {
        this.consumer.close();
        this.consumer = null;
      }
    } catch {
      this.consumer = null;
    }

    try {
      if (this.sendTransport) {
        this.sendTransport.close();
        this.sendTransport = null;
      }
    } catch {
      this.sendTransport = null;
    }

    try {
      if (this.recvTransport) {
        this.recvTransport.close();
        this.recvTransport = null;
      }
    } catch {
      this.recvTransport = null;
    }

    // Stop local audio stream tracks
    if (this.localStream) {
      try {
        const tracks = (this.localStream as any).getTracks?.();
        if (tracks) {
          for (const track of tracks) {
            track.stop();
          }
        }
      } catch {
        /* ignore */
      }
      this.localStream = null;
    }

    this.device = null;
  }

  /**
   * Full call cleanup: stops timers and all mediasoup resources.
   */
  private cleanupCall() {
    this.stopDurationTimer();
    this.cleanupMediasoup();
  }

  /**
   * Reset state to idle and notify listeners. Used with setTimeout
   * to give UI time to show transition states (ended, rejected, etc.).
   */
  private resetState() {
    this.callState = this.getDefaultState();
    this.notifyListeners();
  }

  /**
   * Synchronous reset without notification delay.
   * Used before initiating a new call to ensure clean state.
   */
  private resetStateSync() {
    this.callState = this.getDefaultState();
    // Don't notify — we're about to set a new state immediately
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  disconnect(): void {
    this.cleanupCall();
    this.resetState();

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      this.listenersSetup = false;
    }

    console.log('[VoiceCall] Disconnected from voice server');
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

// Singleton export
export const voiceCallService = new VoiceCallService();

// ── Utility: Format call duration ────────────────────────────────────────

export function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
