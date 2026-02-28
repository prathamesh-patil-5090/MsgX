import { Device, types as mediasoupTypes } from 'mediasoup-client';
import { mediaDevices, MediaStream, registerGlobals } from 'react-native-webrtc';
import { io, Socket } from 'socket.io-client';
import { PermissionsAndroid, Platform } from 'react-native';
import { getAccessToken } from './loginApi';

registerGlobals();

/**
 * Request camera & microphone permissions on Android.
 * On iOS, permissions are handled declaratively via Info.plist.
 */
async function requestMediaPermissions(needsCamera: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  try {
    const permissions: string[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (needsCamera) {
      permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    }

    if (Platform.Version >= 31 && PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
      permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    }

    const results = await PermissionsAndroid.requestMultiple(
      permissions as Array<
        (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS]
      >
    );

    const allGranted = Object.values(results).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED
    );

    if (!allGranted) {
      console.warn('[VoiceCall] Media permissions not fully granted:', results);
    }
    return allGranted;
  } catch (error) {
    console.error('[VoiceCall] Permission request error:', error);
    return false;
  }
}

export type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'ended'
  | 'rejected'
  | 'missed'
  | 'error';

export interface GroupParticipant {
  userId: number;
  userName: string;
  isMuted: boolean;
  status: 'ringing' | 'active' | 'left' | 'disconnected' | 'declined' | 'offline';
}

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
  isGroupCall: boolean;
  groupName: string | null;
  participants: GroupParticipant[];
  isVideoCall: boolean;
  isCameraOn: boolean;
  isFrontCamera: boolean;
  isPeerCameraOn: boolean;
  localVideoStreamURL: string | null;
  remoteVideoStreamURL: string | null;
}

export interface IncomingCallData {
  callId: string;
  callerId: number;
  callerName: string;
  conversationId: string | null;
  isGroup?: boolean;
  isVideoCall?: boolean;
  groupName?: string | null;
  participantCount?: number;
}

export type CallEventListener = (state: CallState) => void;
export type IncomingCallListener = (data: IncomingCallData) => void;

const VOICE_SERVER_URL = process.env.EXPO_PUBLIC_VOICE_SERVER_URL || 'http://localhost:3001';

class VoiceCallService {
  private socket: Socket | null = null;
  private device: Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private producer: mediasoupTypes.Producer | null = null;
  private videoProducer: mediasoupTypes.Producer | null = null;
  private consumer: mediasoupTypes.Consumer | null = null;
  private consumers: Map<string, mediasoupTypes.Consumer> = new Map();
  private localStream: MediaStream | null = null;
  private localVideoStream: MediaStream | null = null;
  private pendingProducers: Array<{
    callId: string;
    producerId: string;
    producerUserId: number;
    kind?: string;
  }> = [];

  private callState: CallState = this.getDefaultState();
  private callEventListeners: Set<CallEventListener> = new Set();
  private incomingCallListeners: Set<IncomingCallListener> = new Set();
  private durationInterval: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private listenersSetup = false;

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
      isGroupCall: false,
      groupName: null,
      participants: [],
      isVideoCall: false,
      isCameraOn: false,
      isFrontCamera: true,
      isPeerCameraOn: false,
      localVideoStreamURL: null,
      remoteVideoStreamURL: null,
    };
  }

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

  async connect(): Promise<void> {
    if (this.socket?.connected) {
      console.log('[VoiceCall] Already connected');
      return;
    }

    if (this.socket && !this.socket.connected) {
      console.log('[VoiceCall] Socket exists but disconnected — attempting reconnect...');
      try {
        this.socket.connect();
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
        return;
      } catch (reconnectError) {
        console.warn('[VoiceCall] Reconnect failed, creating fresh connection:', reconnectError);
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
        this.listenersSetup = false;
      }
    }

    if (this.isConnecting) {
      console.log('[VoiceCall] Already connecting...');
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.isConnecting) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
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

      this.setupSocketListeners();

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

    this.socket.on('call:incoming', (data: IncomingCallData) => {
      console.log('[VoiceCall] Incoming call:', data);

      if (this.callState.status === 'active' || this.callState.status === 'connecting') {
        console.log('[VoiceCall] Auto-rejecting, already in a call');
        this.socket?.emit('call:reject', { callId: data.callId });
        return;
      }

      if (this.callState.status === 'ringing' && this.callState.isCaller) {
        console.log('[VoiceCall] Auto-rejecting, currently calling someone');
        this.socket?.emit('call:reject', { callId: data.callId });
        return;
      }

      const isGroup = !!data.isGroup;
      const isVideoCall = !!data.isVideoCall;

      this.updateState({
        status: 'ringing',
        callId: data.callId,
        remoteUserId: data.callerId,
        remoteUserName: data.callerName,
        conversationId: data.conversationId,
        isCaller: false,
        error: null,
        isGroupCall: isGroup,
        groupName: data.groupName || null,
        isVideoCall,
      });

      for (const listener of this.incomingCallListeners) {
        try {
          listener(data);
        } catch (e) {
          console.error('[VoiceCall] Incoming call listener error:', e);
        }
      }
    });

    this.socket.on('call:accepted', async (data: { callId: string }) => {
      console.log('[VoiceCall] Call accepted:', data.callId);

      if (this.callState.callId !== data.callId) {
        console.warn('[VoiceCall] Received accepted for unknown call:', data.callId);
        return;
      }

      this.updateState({ status: 'active' });
      this.startDurationTimer();

      try {
        await this.setupMediasoupWithRetry();
        console.log('[VoiceCall] Caller mediasoup setup complete');
      } catch (error) {
        console.error('[VoiceCall] Caller mediasoup setup failed after retries:', error);
        this.updateState({
          status: 'error',
          error: 'Failed to setup audio connection',
        });
        await this.endCall().catch((e) =>
          console.error('[VoiceCall] Error ending call after setup failure:', e)
        );
      }
    });

    this.socket.on('call:rejected', (data: { callId: string }) => {
      console.log('[VoiceCall] Call rejected:', data.callId);
      this.updateState({ status: 'rejected' });
      this.cleanupCall();

      setTimeout(() => {
        this.resetState();
      }, 2000);
    });

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

    this.socket.on('call:timeout', (data: { callId: string }) => {
      console.log('[VoiceCall] Call timed out:', data.callId);
      this.updateState({ status: 'missed' });
      this.cleanupCall();

      setTimeout(() => {
        this.resetState();
      }, 2000);
    });

    this.socket.on(
      'call:newProducer',
      async (data: {
        callId: string;
        producerId: string;
        producerUserId: number;
        kind?: string;
      }) => {
        console.log(`[VoiceCall] New ${data.kind || 'audio'} producer from peer:`, data.producerId);

        if (this.callState.status !== 'active') {
          console.warn('[VoiceCall] Not active — queueing producer for later');
          this.pendingProducers.push(data);
          return;
        }

        if (!this.device || !this.recvTransport) {
          console.warn('[VoiceCall] recvTransport not ready — queueing producer');
          this.pendingProducers.push(data);
          return;
        }

        try {
          if (data.kind === 'video') {
            await this.consumeVideo(data.callId, data.producerId);
          } else {
            await this.consumeAudio(data.callId, data.producerId);
          }
        } catch (error) {
          console.error(`[VoiceCall] Failed to consume ${data.kind || 'audio'}:`, error);
        }
      }
    );

    this.socket.on(
      'call:peerMuteChanged',
      (data: { callId: string; userId: number; isMuted: boolean }) => {
        console.log('[VoiceCall] Peer mute changed:', data.isMuted);

        if (this.callState.isGroupCall) {
          const updated = this.callState.participants.map((p) =>
            p.userId === data.userId ? { ...p, isMuted: data.isMuted } : p
          );
          this.updateState({ participants: updated });
        } else {
          this.updateState({ isPeerMuted: data.isMuted });
        }
      }
    );

    this.socket.on(
      'call:peerCameraChanged',
      (data: { callId: string; userId: number; isCameraOn: boolean }) => {
        console.log('[VoiceCall] Peer camera changed:', data.isCameraOn);

        if (this.callState.callId !== data.callId) return;

        if (!this.callState.isGroupCall) {
          this.updateState({ isPeerCameraOn: data.isCameraOn });
        }
      }
    );

    this.socket.on('call:upgradedToVideo', async (data: { callId: string; byUserId: number }) => {
      console.log('[VoiceCall] Call upgraded to video by peer:', data.byUserId);

      if (this.callState.callId !== data.callId) return;

      this.updateState({ isVideoCall: true });
    });

    this.socket.on(
      'call:participantJoined',
      (data: { callId: string; userId: number; userName: string; participantCount: number }) => {
        console.log('[VoiceCall] Participant joined:', data.userId, data.userName);

        if (!this.callState.isGroupCall || this.callState.callId !== data.callId) return;

        const existing = this.callState.participants.find((p) => p.userId === data.userId);
        if (existing) {
          const updated = this.callState.participants.map((p) =>
            p.userId === data.userId ? { ...p, status: 'active' as const } : p
          );
          this.updateState({ participants: updated });
        } else {
          this.updateState({
            participants: [
              ...this.callState.participants,
              {
                userId: data.userId,
                userName: data.userName,
                isMuted: false,
                status: 'active',
              },
            ],
          });
        }
      }
    );

    this.socket.on(
      'call:participantLeft',
      (data: { callId: string; userId: number; participantCount: number; reason?: string }) => {
        console.log('[VoiceCall] Participant left:', data.userId);

        if (!this.callState.isGroupCall || this.callState.callId !== data.callId) return;

        const updated = this.callState.participants.filter((p) => p.userId !== data.userId);
        this.updateState({ participants: updated });

        this.removeConsumerForUser(data.userId);
      }
    );

    this.socket.on('call:participantDeclined', (data: { callId: string; userId: number }) => {
      console.log('[VoiceCall] Participant declined:', data.userId);

      if (!this.callState.isGroupCall || this.callState.callId !== data.callId) return;

      const updated = this.callState.participants.map((p) =>
        p.userId === data.userId ? { ...p, status: 'declined' as const } : p
      );
      this.updateState({ participants: updated });
    });

    this.socket.on(
      'call:peerDisconnected',
      (data: { callId: string; userId: number; timeoutMs: number }) => {
        console.log('[VoiceCall] Peer disconnected, waiting for reconnection:', data);

        if (this.callState.callId !== data.callId) return;

        this.updateState({
          error: 'Peer disconnected — waiting for them to reconnect...',
          isPeerMuted: true,
        });
      }
    );

    this.socket.on('call:peerReconnected', (data: { callId: string; userId: number }) => {
      console.log('[VoiceCall] Peer reconnected:', data);

      if (this.callState.callId !== data.callId) return;

      this.updateState({
        error: null,
        isPeerMuted: false,
      });
    });

    this.socket.on(
      'call:rejoin',
      async (data: {
        callId: string;
        status: string;
        remoteUserId: number;
        isCaller: boolean;
        conversationId: string | null;
        isVideoCall?: boolean;
      }) => {
        console.log('[VoiceCall] Rejoining call after reconnection:', data);

        this.updateState({
          status: 'active',
          callId: data.callId,
          remoteUserId: data.remoteUserId,
          conversationId: data.conversationId,
          isCaller: data.isCaller,
          isVideoCall: !!data.isVideoCall,
          error: null,
        });

        this.startDurationTimer();

        try {
          await this.setupMediasoupWithRetry();
          console.log('[VoiceCall] Rejoin mediasoup setup complete');
        } catch (error) {
          console.error('[VoiceCall] Rejoin mediasoup setup failed:', error);
          this.updateState({
            status: 'error',
            error: 'Failed to reconnect audio',
          });
          await this.endCall().catch(() => {});
        }
      }
    );

    this.socket.on(
      'call:waitingForPeers',
      (data: { callId: string; message: string; timeoutMs: number }) => {
        console.log('[VoiceCall] Waiting for peers:', data.message);

        if (this.callState.callId !== data.callId) return;

        this.updateState({
          error: data.message,
        });
      }
    );

    this.socket.on('disconnect', (reason: string) => {
      console.log('[VoiceCall] Socket disconnected:', reason);
      if (this.callState.status === 'active' || this.callState.status === 'ringing') {
        this.updateState({
          error: 'Connection lost — reconnecting...',
        });

        this.cleanupMediasoup();
      }
    });

    this.socket.on('connect', () => {
      console.log('[VoiceCall] Socket (re)connected, id:', this.socket?.id);

      if (this.callState.error === 'Connection lost — reconnecting...') {
        this.updateState({ error: null });
      }
    });
  }

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

        this.cleanupMediasoup();

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

    this.device = new Device();

    await this.device.load({
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log('[VoiceCall] Device loaded with RTP capabilities');

    if (this.callState.status !== 'active') {
      throw new Error('Call ended during setup');
    }

    await this.createSendTransport(callId);
    console.log('[VoiceCall] Send transport ready');

    if (this.callState.status !== 'active') {
      throw new Error('Call ended during setup');
    }

    await this.createRecvTransport(callId);
    console.log('[VoiceCall] Recv transport ready');

    await this.drainPendingProducers();

    await this.requestExistingProducers(callId);

    if (this.callState.status !== 'active') {
      throw new Error('Call ended during setup');
    }

    await this.produceAudio(callId);
    console.log('[VoiceCall] Audio producing');

    if (this.callState.isVideoCall) {
      try {
        await this.produceVideo(callId);
        console.log('[VoiceCall] Video producing');
      } catch (error) {
        console.warn('[VoiceCall] Video production failed (audio-only fallback):', error);
      }
    }
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
      await requestMediaPermissions(false);

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

    const newConsumer = await this.recvTransport.consume({
      id: consumerData.id,
      producerId: consumerData.producerId,
      kind: consumerData.kind,
      rtpParameters: consumerData.rtpParameters,
    });

    const resumeResult = await this.emitAsync('resumeConsumer', {
      callId,
      consumerId: newConsumer.id,
    });

    if (resumeResult.error) {
      console.warn('[VoiceCall] Resume consumer warning:', resumeResult.error);
    }

    this.consumer = newConsumer;
    this.consumers.set(producerId, newConsumer);

    console.log('[VoiceCall] Audio consumer created and resumed');
  }

  /**
   * Drain any producers that were queued while recvTransport wasn't ready.
   */
  private async drainPendingProducers(): Promise<void> {
    if (this.pendingProducers.length === 0) return;

    console.log(`[VoiceCall] Draining ${this.pendingProducers.length} pending producer(s)...`);
    const pending = [...this.pendingProducers];
    this.pendingProducers = [];

    for (const data of pending) {
      try {
        if (data.kind === 'video') {
          await this.consumeVideo(data.callId, data.producerId);
        } else {
          await this.consumeAudio(data.callId, data.producerId);
        }
      } catch (error) {
        console.error(`[VoiceCall] Failed to consume queued ${data.kind || 'audio'}:`, error);
      }
    }
  }

  /**
   * Ask the server for any existing producers in this call that we haven't consumed yet.
   * This covers the case where the peer produced before we had our recvTransport ready
   * and the newProducer notification was lost or arrived too early.
   */
  private async requestExistingProducers(callId: string): Promise<void> {
    try {
      const response = await this.emitAsync('getExistingProducers', { callId });
      if (response.error) {
        console.warn('[VoiceCall] getExistingProducers error:', response.error);
        return;
      }

      const producers: Array<{ producerId: string; producerUserId: number; kind: string }> =
        response.producers || [];

      console.log(`[VoiceCall] Server reports ${producers.length} existing producer(s)`);

      for (const p of producers) {
        if (this.consumers.has(p.producerId)) {
          console.log(`[VoiceCall] Already consuming producer ${p.producerId}, skipping`);
          continue;
        }

        try {
          if (p.kind === 'video') {
            await this.consumeVideo(callId, p.producerId);
          } else {
            await this.consumeAudio(callId, p.producerId);
          }
        } catch (error) {
          console.error(`[VoiceCall] Failed to consume existing ${p.kind}:`, error);
        }
      }
    } catch (error) {
      console.warn('[VoiceCall] requestExistingProducers failed:', error);
    }
  }

  /**
   * Remove the consumer associated with a specific user (for group calls).
   */
  private removeConsumerForUser(_userId: number): void {}

  private async produceVideo(callId: string): Promise<void> {
    try {
      console.log('[VoiceCall] Requesting camera permission...');
      const granted = await requestMediaPermissions(true);
      if (!granted) {
        throw new Error('Camera permission denied');
      }

      console.log('[VoiceCall] Requesting camera access...');
      const stream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: this.callState.isFrontCamera ? 'user' : 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
      });

      this.localVideoStream = stream as MediaStream;
      const videoTrack = (this.localVideoStream as any).getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No video track available');
      }

      const streamURL = (this.localVideoStream as any).toURL
        ? (this.localVideoStream as any).toURL()
        : null;

      this.videoProducer = await this.sendTransport!.produce({
        track: videoTrack,
        codecOptions: {},
        encodings: [{ maxBitrate: 500000, scaleResolutionDownBy: 2 }, { maxBitrate: 1000000 }],
      });

      this.videoProducer.on('trackended', () => {
        console.log('[VoiceCall] Video track ended');
        this.updateState({ isCameraOn: false, localVideoStreamURL: null });
      });

      this.videoProducer.on('transportclose', () => {
        console.log('[VoiceCall] Video producer transport closed');
        this.videoProducer = null;
      });

      this.updateState({
        isCameraOn: true,
        localVideoStreamURL: streamURL,
      });

      console.log('[VoiceCall] Video producer created');
    } catch (error) {
      console.error('[VoiceCall] Failed to produce video:', error);
      throw error;
    }
  }

  private async consumeVideo(callId: string, producerId: string): Promise<void> {
    if (!this.device || !this.recvTransport) {
      console.warn('[VoiceCall] Cannot consume video: device or recv transport not ready');
      return;
    }

    console.log(`[VoiceCall] Consuming video producer ${producerId}...`);

    const consumerData = await this.emitAsync('consume', {
      callId,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    if (consumerData.error) {
      throw new Error(`consume video failed: ${consumerData.error}`);
    }

    const newConsumer = await this.recvTransport.consume({
      id: consumerData.id,
      producerId: consumerData.producerId,
      kind: consumerData.kind,
      rtpParameters: consumerData.rtpParameters,
    });

    const resumeResult = await this.emitAsync('resumeConsumer', {
      callId,
      consumerId: newConsumer.id,
    });

    if (resumeResult.error) {
      console.warn('[VoiceCall] Resume video consumer warning:', resumeResult.error);
    }

    this.consumers.set(producerId, newConsumer);

    const remoteStream = new MediaStream([newConsumer.track]);
    const streamURL = (remoteStream as any).toURL ? (remoteStream as any).toURL() : null;

    this.updateState({
      remoteVideoStreamURL: streamURL,
      isPeerCameraOn: true,
    });

    console.log('[VoiceCall] Video consumer created and resumed');
  }

  async toggleCamera(): Promise<void> {
    if (this.callState.status !== 'active' || !this.callState.isVideoCall) return;

    const callId = this.callState.callId;
    if (!callId) return;

    if (this.callState.isCameraOn) {
      if (this.videoProducer) {
        this.videoProducer.pause();
        this.socket?.emit('call:toggleCamera', { callId, isCameraOn: false });
      }
      if (this.localVideoStream) {
        const tracks = (this.localVideoStream as any).getVideoTracks?.();
        if (tracks) {
          for (const track of tracks) track.stop();
        }
        this.localVideoStream = null;
      }
      this.updateState({ isCameraOn: false, localVideoStreamURL: null });
    } else {
      try {
        const granted = await requestMediaPermissions(true);
        if (!granted) {
          console.warn('[VoiceCall] Camera permission denied for toggle');
          return;
        }

        const stream = await mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: this.callState.isFrontCamera ? 'user' : 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24 },
          },
        });

        this.localVideoStream = stream as MediaStream;
        const videoTrack = (this.localVideoStream as any).getVideoTracks()[0];
        const streamURL = (this.localVideoStream as any).toURL
          ? (this.localVideoStream as any).toURL()
          : null;

        if (this.videoProducer && !this.videoProducer.closed) {
          await this.videoProducer.replaceTrack({ track: videoTrack });
          this.videoProducer.resume();
        } else {
          this.videoProducer = await this.sendTransport!.produce({
            track: videoTrack,
            codecOptions: {},
            encodings: [{ maxBitrate: 500000, scaleResolutionDownBy: 2 }, { maxBitrate: 1000000 }],
          });
        }

        this.socket?.emit('call:toggleCamera', { callId, isCameraOn: true });
        this.updateState({ isCameraOn: true, localVideoStreamURL: streamURL });
      } catch (error) {
        console.error('[VoiceCall] Failed to re-enable camera:', error);
      }
    }
  }

  async switchCamera(): Promise<void> {
    if (this.callState.status !== 'active' || !this.callState.isCameraOn) return;

    const newFront = !this.callState.isFrontCamera;
    this.updateState({ isFrontCamera: newFront });

    try {
      const granted = await requestMediaPermissions(true);
      if (!granted) {
        this.updateState({ isFrontCamera: !newFront });
        return;
      }

      const stream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: newFront ? 'user' : 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
      });

      if (this.localVideoStream) {
        const oldTracks = (this.localVideoStream as any).getVideoTracks?.();
        if (oldTracks) {
          for (const track of oldTracks) track.stop();
        }
      }

      this.localVideoStream = stream as MediaStream;
      const videoTrack = (this.localVideoStream as any).getVideoTracks()[0];
      const streamURL = (this.localVideoStream as any).toURL
        ? (this.localVideoStream as any).toURL()
        : null;

      if (this.videoProducer && !this.videoProducer.closed) {
        await this.videoProducer.replaceTrack({ track: videoTrack });
      }

      this.updateState({ localVideoStreamURL: streamURL });
      console.log(`[VoiceCall] Switched to ${newFront ? 'front' : 'rear'} camera`);
    } catch (error) {
      console.error('[VoiceCall] Failed to switch camera:', error);
      this.updateState({ isFrontCamera: !newFront });
    }
  }

  async upgradeToVideo(): Promise<void> {
    if (this.callState.status !== 'active') return;
    if (this.callState.isGroupCall) {
      console.warn('[VoiceCall] Cannot upgrade group calls to video');
      return;
    }
    if (this.callState.isVideoCall) {
      console.warn('[VoiceCall] Already a video call');
      return;
    }

    const callId = this.callState.callId;
    if (!callId) return;

    try {
      const result = await this.emitAsync('call:upgradeToVideo', { callId });
      if (result.error) {
        console.error('[VoiceCall] Upgrade to video failed:', result.error);
        return;
      }

      this.updateState({ isVideoCall: true });

      await this.produceVideo(callId);
      console.log('[VoiceCall] Upgraded to video call');
    } catch (error) {
      console.error('[VoiceCall] Failed to upgrade to video:', error);
    }
  }

  async initiateCall(
    calleeId: number,
    callerName: string,
    conversationId?: string,
    isVideoCall: boolean = false
  ): Promise<void> {
    try {
      await this.connect();

      if (
        this.callState.status !== 'idle' &&
        this.callState.status !== 'ended' &&
        this.callState.status !== 'rejected' &&
        this.callState.status !== 'missed' &&
        this.callState.status !== 'error'
      ) {
        throw new Error('Already in a call');
      }

      this.cleanupCall();
      this.resetStateSync();

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
        isVideoCall,
      });

      const result = await this.emitAsync('call:initiate', {
        calleeId,
        callerName,
        conversationId,
        isVideoCall,
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

  async initiateGroupCall(
    participantIds: number[],
    callerName: string,
    conversationId: string,
    groupName: string,
    isVideoCall: boolean = false
  ): Promise<void> {
    try {
      await this.connect();

      if (
        this.callState.status !== 'idle' &&
        this.callState.status !== 'ended' &&
        this.callState.status !== 'rejected' &&
        this.callState.status !== 'missed' &&
        this.callState.status !== 'error'
      ) {
        throw new Error('Already in a call');
      }

      this.cleanupCall();
      this.resetStateSync();

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
        remoteUserId: null,
        remoteUserName: null,
        conversationId,
        isCaller: true,
        error: null,
        isMuted: false,
        isPeerMuted: false,
        duration: 0,
        isGroupCall: true,
        isVideoCall,
        groupName,
        participants: [],
      });

      const result = await this.emitAsync('call:initiateGroup', {
        participantIds,
        callerName,
        conversationId,
        groupName,
        isVideoCall,
      });

      if (result.error) {
        this.updateState({ status: 'error', error: result.error });
        setTimeout(() => this.resetState(), 2500);
        throw new Error(result.error);
      }

      const participants: GroupParticipant[] = (result.participants || []).map((p: any) => ({
        userId: p.userId,
        userName: p.name || `User ${p.userId}`,
        isMuted: false,
        status: p.status || 'ringing',
      }));

      this.updateState({
        status: 'active',
        callId: result.callId,
        participants,
      });

      this.startDurationTimer();

      try {
        await this.setupMediasoupWithRetry();
        console.log('[VoiceCall] Group call initiated and media setup complete');
      } catch (error) {
        console.error('[VoiceCall] Group call mediasoup setup failed:', error);
        this.updateState({
          status: 'error',
          error: 'Failed to setup audio connection',
        });
        await this.endCall().catch((e) =>
          console.error('[VoiceCall] Error ending group call after setup failure:', e)
        );
      }
    } catch (error: any) {
      console.error('[VoiceCall] Failed to initiate group call:', error);
      if (this.callState.status === 'connecting') {
        this.updateState({
          status: 'error',
          error: error.message || 'Failed to start group call',
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
    const isGroup = this.callState.isGroupCall;

    try {
      if (isGroup) {
        const result = await this.emitAsync('call:joinGroup', { callId });

        if (result.error) {
          throw new Error(result.error);
        }

        const participants: GroupParticipant[] = (result.participants || []).map((p: any) => ({
          userId: p.userId,
          userName: p.name || `User ${p.userId}`,
          isMuted: false,
          status: p.status || 'active',
        }));

        this.updateState({ status: 'active', participants });
      } else {
        const result = await this.emitAsync('call:accept', { callId });

        if (result.error) {
          throw new Error(result.error);
        }

        this.updateState({ status: 'active' });
      }

      this.startDurationTimer();

      await this.setupMediasoupWithRetry();

      console.log('[VoiceCall] Call accepted and media setup complete');
    } catch (error: any) {
      console.error('[VoiceCall] Failed to accept call:', error);
      this.updateState({
        status: 'error',
        error: 'Failed to connect audio',
      });
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
    const isGroup = this.callState.isGroupCall;

    if (!callId) {
      this.cleanupCall();
      this.resetState();
      return;
    }

    this.updateState({ status: 'ended' });
    this.cleanupCall();

    try {
      if (isGroup) {
        await this.emitAsync('call:leaveGroup', { callId });
        console.log('[VoiceCall] Left group call:', callId);
      } else {
        await this.emitAsync('call:end', { callId });
        console.log('[VoiceCall] Server acknowledged call:end for', callId);
      }
    } catch (error) {
      console.error('[VoiceCall] Error notifying server of call end:', error);
      try {
        this.socket?.emit(isGroup ? 'call:leaveGroup' : 'call:end', { callId });
      } catch (_e) {}
    }

    setTimeout(() => this.resetState(), 1000);
  }

  toggleMute(): void {
    if (this.callState.status !== 'active') return;

    const newMuted = !this.callState.isMuted;
    this.updateState({ isMuted: newMuted });

    if (this.producer) {
      if (newMuted) {
        this.producer.pause();
      } else {
        this.producer.resume();
      }
    }

    if (this.socket && this.callState.callId) {
      this.socket.emit('call:toggleMute', {
        callId: this.callState.callId,
        isMuted: newMuted,
      });
    }
  }

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
      if (this.videoProducer) {
        this.videoProducer.close();
        this.videoProducer = null;
      }
    } catch {
      this.videoProducer = null;
    }

    try {
      if (this.consumer) {
        this.consumer.close();
        this.consumer = null;
      }
    } catch {
      this.consumer = null;
    }

    for (const [key, c] of this.consumers) {
      try {
        c.close();
      } catch {}
    }
    this.consumers.clear();

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

    if (this.localStream) {
      try {
        const tracks = (this.localStream as any).getTracks?.();
        if (tracks) {
          for (const track of tracks) {
            track.stop();
          }
        }
      } catch {}
      this.localStream = null;
    }

    if (this.localVideoStream) {
      try {
        const tracks = (this.localVideoStream as any).getTracks?.();
        if (tracks) {
          for (const track of tracks) {
            track.stop();
          }
        }
      } catch {}
      this.localVideoStream = null;
    }

    this.device = null;
  }

  /**
   * Full call cleanup: stops timers and all mediasoup resources.
   */
  private cleanupCall() {
    this.stopDurationTimer();
    this.cleanupMediasoup();
    this.pendingProducers = [];
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
  }

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

export const voiceCallService = new VoiceCallService();

export function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
