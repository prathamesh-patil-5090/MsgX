import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { audioService } from '../services/audioService';
import { notificationService } from '../services/notificationService';
import {
  voiceCallService,
  formatCallDuration,
  type CallState,
  type IncomingCallData,
} from '../services/voiceCallService';
import IncomingCallScreen from './IncomingCallScreen';
import VoiceCallScreen from './VoiceCallScreen';

// ─── Context Types ─────────────────────────────────────────────────────────

interface CallContextValue {
  callState: CallState;
  initiateCall: (
    calleeId: number,
    callerName: string,
    calleeName: string,
    conversationId?: string
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => Promise<void>;
  isSpeakerOn: boolean;
  isInCall: boolean;
  isCallMinimized: boolean;
  minimizeCall: () => void;
  restoreCall: () => void;
  connectVoiceService: () => Promise<void>;
}

const defaultCallState: CallState = {
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

const CallContext = createContext<CallContextValue>({
  callState: defaultCallState,
  initiateCall: async () => {},
  acceptCall: async () => {},
  rejectCall: async () => {},
  endCall: async () => {},
  toggleMute: () => {},
  toggleSpeaker: async () => {},
  isSpeakerOn: false,
  isInCall: false,
  isCallMinimized: false,
  minimizeCall: () => {},
  restoreCall: () => {},
  connectVoiceService: async () => {},
});

export const useCall = () => useContext(CallContext);

// ─── Provider Component ────────────────────────────────────────────────────

interface CallProviderProps {
  children: React.ReactNode;
}

export function CallProvider({ children }: CallProviderProps) {
  const [callState, setCallState] = useState<CallState>(defaultCallState);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [showCallScreen, setShowCallScreen] = useState(false);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [calleeName, setCalleeName] = useState<string>('');
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const connectedRef = useRef(false);
  const callNotificationIdRef = useRef<string | null>(null);

  // Track previous status for transition detection
  const prevStatusRef = useRef<string>('idle');

  // ── Connect to voice server on mount ─────────────────────────────

  const connectVoiceService = useCallback(async () => {
    if (connectedRef.current && voiceCallService.isConnected()) return;
    try {
      await voiceCallService.connect();
      connectedRef.current = true;
    } catch (error) {
      console.error('[CallProvider] Failed to connect voice service:', error);
      connectedRef.current = false;
    }
  }, []);

  useEffect(() => {
    connectVoiceService();

    return () => {
      // Don't disconnect on unmount — the service is a singleton
      // and we want it to stay connected for incoming calls
    };
  }, [connectVoiceService]);

  // ── Listen for app state changes ─────────────────────────────────

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // App came to foreground — reconnect if needed
        if (!voiceCallService.isConnected()) {
          connectedRef.current = false;
          connectVoiceService();
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [connectVoiceService]);

  // ── Subscribe to call state changes ──────────────────────────────

  useEffect(() => {
    const unsubState = voiceCallService.onCallStateChange((newState) => {
      const prevStatus = prevStatusRef.current;
      prevStatusRef.current = newState.status;

      setCallState(newState);

      // ── Audio transitions based on state changes ──────────────

      // Caller starts ringing → play outgoing ring
      if (newState.status === 'ringing' && newState.isCaller && prevStatus !== 'ringing') {
        audioService.startOutgoingRing().catch(console.error);
      }

      // Call becomes active → stop all ring sounds, configure for call
      if (newState.status === 'active' && prevStatus !== 'active') {
        audioService.stopRingtone().catch(console.error);
        audioService.stopOutgoingRing().catch(console.error);
        audioService.configureForCall().catch(console.error);
        setIsSpeakerOn(false);
      }

      // Show call screen when in active states (caller side)
      if (
        newState.status === 'connecting' ||
        newState.status === 'ringing' ||
        newState.status === 'active'
      ) {
        if (newState.isCaller) {
          setShowCallScreen(true);
        }
      }

      // Call ended/error/rejected → cleanup audio
      if (
        newState.status === 'ended' ||
        newState.status === 'error' ||
        newState.status === 'idle'
      ) {
        // Dismiss incoming call notification
        if (callNotificationIdRef.current) {
          notificationService
            .dismissCallNotification(callNotificationIdRef.current)
            .catch(() => {});
          callNotificationIdRef.current = null;
        }

        // Stop any ringing/audio
        audioService.stopRingtone().catch(console.error);
        audioService.stopOutgoingRing().catch(console.error);

        // Play end sound & vibrate
        if (prevStatus === 'active' || prevStatus === 'ringing' || prevStatus === 'connecting') {
          audioService.playCallEndSound().catch(console.error);
          audioService.vibrateShort();
        }

        // Cleanup audio mode after a brief delay
        setTimeout(() => {
          audioService.cleanup().catch(console.error);
          setIsSpeakerOn(false);
        }, 500);

        // Hide call screen after delay
        setTimeout(() => {
          setShowCallScreen(false);
          setIncomingCall(null);
        }, 1500);
      }

      if (newState.status === 'rejected' || newState.status === 'missed') {
        // Dismiss incoming call notification
        if (callNotificationIdRef.current) {
          notificationService
            .dismissCallNotification(callNotificationIdRef.current)
            .catch(() => {});
          callNotificationIdRef.current = null;
        }

        // Stop ringing
        audioService.stopRingtone().catch(console.error);
        audioService.stopOutgoingRing().catch(console.error);
        audioService.vibrateShort();

        // Cleanup audio
        setTimeout(() => {
          audioService.cleanup().catch(console.error);
          setIsSpeakerOn(false);
        }, 500);

        // Hide call screen after showing status
        setTimeout(() => {
          setShowCallScreen(false);
          setIncomingCall(null);
        }, 2500);
      }
    });

    const unsubIncoming = voiceCallService.onIncomingCall((data) => {
      setIncomingCall(data);
      // Start ringtone + vibration for incoming call
      audioService.startRingtone().catch(console.error);

      // Show a system notification (useful when app is in background)
      notificationService
        .notifyIncomingCall(data.callId, data.callerName, data.conversationId ?? undefined)
        .then((nId) => {
          callNotificationIdRef.current = nId;
        })
        .catch(console.error);
    });

    return () => {
      unsubState();
      unsubIncoming();
    };
  }, []);

  // ── Call Actions ─────────────────────────────────────────────────

  const initiateCall = useCallback(
    async (
      calleeId: number,
      callerName: string,
      calleeDisplayName: string,
      conversationId?: string
    ) => {
      try {
        await connectVoiceService();
        setCalleeName(calleeDisplayName);
        setShowCallScreen(true);
        await voiceCallService.initiateCall(calleeId, callerName, conversationId);
      } catch (error: any) {
        console.error('[CallProvider] initiateCall error:', error);
        // State is handled inside the service
      }
    },
    [connectVoiceService]
  );

  const acceptCall = useCallback(async () => {
    try {
      // Stop ringtone immediately on accept
      await audioService.stopRingtone();
      // Dismiss call notification
      if (callNotificationIdRef.current) {
        notificationService.dismissCallNotification(callNotificationIdRef.current).catch(() => {});
        callNotificationIdRef.current = null;
      }
      setIncomingCall(null);
      setShowCallScreen(true);
      await voiceCallService.acceptCall();
    } catch (error: any) {
      console.error('[CallProvider] acceptCall error:', error);
    }
  }, []);

  const rejectCall = useCallback(async () => {
    try {
      // Stop ringtone immediately on reject
      await audioService.stopRingtone();
      // Dismiss call notification
      if (callNotificationIdRef.current) {
        notificationService.dismissCallNotification(callNotificationIdRef.current).catch(() => {});
        callNotificationIdRef.current = null;
      }
      setIncomingCall(null);
      await voiceCallService.rejectCall();
    } catch (error: any) {
      console.error('[CallProvider] rejectCall error:', error);
    }
  }, []);

  const endCall = useCallback(async () => {
    try {
      await voiceCallService.endCall();
    } catch (error: any) {
      console.error('[CallProvider] endCall error:', error);
    }
  }, []);

  const toggleMute = useCallback(() => {
    voiceCallService.toggleMute();
  }, []);

  const toggleSpeaker = useCallback(async () => {
    try {
      const newState = await audioService.toggleSpeaker();
      setIsSpeakerOn(newState);
    } catch (error) {
      console.error('[CallProvider] toggleSpeaker error:', error);
    }
  }, []);

  const isInCall =
    callState.status === 'active' ||
    callState.status === 'ringing' ||
    callState.status === 'connecting';

  // ── Minimize / Restore call ──────────────────────────────────────

  const minimizeCall = useCallback(() => {
    setIsCallMinimized(true);
  }, []);

  const restoreCall = useCallback(() => {
    setIsCallMinimized(false);
  }, []);

  // Reset minimized state when call ends
  useEffect(() => {
    if (!isInCall) {
      setIsCallMinimized(false);
    }
  }, [isInCall]);

  // ── Determine display name for remote user ───────────────────────

  const remoteDisplayName =
    callState.remoteUserName ||
    (incomingCall ? incomingCall.callerName : null) ||
    calleeName ||
    'Unknown';

  // ── Context value ────────────────────────────────────────────────

  const contextValue: CallContextValue = {
    callState,
    initiateCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleSpeaker,
    isSpeakerOn,
    isInCall,
    isCallMinimized,
    minimizeCall,
    restoreCall,
    connectVoiceService,
  };

  return (
    <CallContext.Provider value={contextValue}>
      {children}

      {/* Incoming Call Overlay */}
      {incomingCall && callState.status === 'ringing' && !callState.isCaller && (
        <IncomingCallScreen
          callerName={incomingCall.callerName}
          onAccept={acceptCall}
          onReject={rejectCall}
        />
      )}

      {/* Floating call banner when minimized */}
      {showCallScreen && isCallMinimized && isInCall && (
        <TouchableOpacity style={floatingStyles.banner} onPress={restoreCall} activeOpacity={0.85}>
          <View style={floatingStyles.bannerLeft}>
            <View style={floatingStyles.liveDot} />
            <Text style={floatingStyles.bannerName} numberOfLines={1}>
              {remoteDisplayName}
            </Text>
          </View>
          <View style={floatingStyles.bannerRight}>
            <Text style={floatingStyles.bannerDuration}>
              {callState.status === 'active'
                ? formatCallDuration(callState.duration)
                : callState.status === 'ringing'
                  ? 'Ringing...'
                  : 'Connecting...'}
            </Text>
            <TouchableOpacity
              style={floatingStyles.bannerEndButton}
              onPress={endCall}
              activeOpacity={0.7}>
              <Ionicons
                name="call"
                size={16}
                color="#fff"
                style={{ transform: [{ rotate: '135deg' }] }}
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* Active / Outgoing Call Screen */}
      {showCallScreen && !isCallMinimized && (
        <VoiceCallScreen
          visible={showCallScreen && !isCallMinimized}
          callState={callState}
          remoteUserName={remoteDisplayName}
          onEndCall={endCall}
          onToggleMute={toggleMute}
          onToggleSpeaker={toggleSpeaker}
          onMinimize={minimizeCall}
          isSpeakerOn={isSpeakerOn}
        />
      )}
    </CallContext.Provider>
  );
}

// ─── Floating Banner Styles ────────────────────────────────────────────────

const floatingStyles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 36,
    left: 12,
    right: 12,
    backgroundColor: '#1d4ed8',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 9998,
    elevation: 9998,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4ade80',
  },
  bannerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
  },
  bannerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerDuration: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  bannerEndButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CallProvider;
