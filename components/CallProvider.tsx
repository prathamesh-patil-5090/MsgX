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
import { audioService, type AudioOutputRoute } from '../services/audioService';
import { notificationService } from '../services/notificationService';
import {
  voiceCallService,
  formatCallDuration,
  type CallState,
  type IncomingCallData,
  type GroupParticipant,
} from '../services/voiceCallService';
import IncomingCallScreen from './IncomingCallScreen';
import VoiceCallScreen from './VoiceCallScreen';

interface CallContextValue {
  callState: CallState;
  initiateCall: (
    calleeId: number,
    callerName: string,
    calleeName: string,
    conversationId?: string,
    isVideoCall?: boolean
  ) => Promise<void>;
  initiateGroupCall: (
    participantIds: number[],
    callerName: string,
    conversationId: string,
    groupName: string,
    isVideoCall?: boolean
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  cycleAudioOutput: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  upgradeToVideo: () => Promise<void>;
  isSpeakerOn: boolean;
  audioRoute: AudioOutputRoute;
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

const CallContext = createContext<CallContextValue>({
  callState: defaultCallState,
  initiateCall: async () => {},
  initiateGroupCall: async () => {},
  acceptCall: async () => {},
  rejectCall: async () => {},
  endCall: async () => {},
  toggleMute: () => {},
  cycleAudioOutput: async () => {},
  toggleSpeaker: async () => {},
  toggleCamera: async () => {},
  switchCamera: async () => {},
  upgradeToVideo: async () => {},
  isSpeakerOn: false,
  audioRoute: 'earpiece' as AudioOutputRoute,
  isInCall: false,
  isCallMinimized: false,
  minimizeCall: () => {},
  restoreCall: () => {},
  connectVoiceService: async () => {},
});

export const useCall = () => useContext(CallContext);

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
  const [audioRoute, setAudioRoute] = useState<AudioOutputRoute>('earpiece');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const connectedRef = useRef(false);
  const callNotificationIdRef = useRef<string | null>(null);

  const prevStatusRef = useRef<string>('idle');

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

    return () => {};
  }, [connectVoiceService]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
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

  useEffect(() => {
    const unsubRoute = audioService.onRouteChange((route) => {
      setAudioRoute(route);
      setIsSpeakerOn(route === 'speaker');
    });
    return () => {
      unsubRoute();
    };
  }, []);

  useEffect(() => {
    const unsubState = voiceCallService.onCallStateChange((newState) => {
      const prevStatus = prevStatusRef.current;
      prevStatusRef.current = newState.status;

      setCallState(newState);

      if (newState.status === 'ringing' && newState.isCaller && prevStatus !== 'ringing') {
        audioService.startOutgoingRing().catch(console.error);
      }

      if (newState.status === 'active' && prevStatus !== 'active') {
        audioService.stopRingtone().catch(console.error);
        audioService.stopOutgoingRing().catch(console.error);
        audioService.configureForCall(newState.isVideoCall).catch(console.error);
        const defaultRoute = newState.isVideoCall ? 'speaker' : 'earpiece';
        setAudioRoute(defaultRoute);
        setIsSpeakerOn(defaultRoute === 'speaker');
      }

      if (
        newState.status === 'connecting' ||
        newState.status === 'ringing' ||
        newState.status === 'active'
      ) {
        if (newState.isCaller) {
          setShowCallScreen(true);
        }
      }

      if (
        newState.status === 'ended' ||
        newState.status === 'error' ||
        newState.status === 'idle'
      ) {
        if (callNotificationIdRef.current) {
          notificationService
            .dismissCallNotification(callNotificationIdRef.current)
            .catch(() => {});
          callNotificationIdRef.current = null;
        }

        audioService.stopRingtone().catch(console.error);
        audioService.stopOutgoingRing().catch(console.error);

        if (prevStatus === 'active' || prevStatus === 'ringing' || prevStatus === 'connecting') {
          audioService.playCallEndSound().catch(console.error);
          audioService.vibrateShort();
        }

        setTimeout(() => {
          audioService.cleanup().catch(console.error);
          setIsSpeakerOn(false);
          setAudioRoute('earpiece');
        }, 500);

        setTimeout(() => {
          setShowCallScreen(false);
          setIncomingCall(null);
        }, 1500);
      }

      if (newState.status === 'rejected' || newState.status === 'missed') {
        if (callNotificationIdRef.current) {
          notificationService
            .dismissCallNotification(callNotificationIdRef.current)
            .catch(() => {});
          callNotificationIdRef.current = null;
        }

        audioService.stopRingtone().catch(console.error);
        audioService.stopOutgoingRing().catch(console.error);
        audioService.vibrateShort();

        setTimeout(() => {
          audioService.cleanup().catch(console.error);
          setIsSpeakerOn(false);
          setAudioRoute('earpiece');
        }, 500);

        setTimeout(() => {
          setShowCallScreen(false);
          setIncomingCall(null);
        }, 2500);
      }
    });

    const unsubIncoming = voiceCallService.onIncomingCall((data) => {
      setIncomingCall(data);

      audioService.startRingtone().catch(console.error);

      const displayName = data.isGroup
        ? `${data.callerName} (${data.groupName || 'Group Call'})`
        : data.callerName;
      notificationService
        .notifyIncomingCall(data.callId, displayName, data.conversationId ?? undefined)
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

  const initiateCall = useCallback(
    async (
      calleeId: number,
      callerName: string,
      calleeDisplayName: string,
      conversationId?: string,
      isVideoCall: boolean = false
    ) => {
      try {
        await connectVoiceService();
        setCalleeName(calleeDisplayName);
        setShowCallScreen(true);
        if (isVideoCall) {
          try {
            await audioService.setAudioRoute('speaker');
            setAudioRoute('speaker');
            setIsSpeakerOn(true);
          } catch {}
        }
        await voiceCallService.initiateCall(calleeId, callerName, conversationId, isVideoCall);
      } catch (error: any) {
        console.error('[CallProvider] initiateCall error:', error);
      }
    },
    [connectVoiceService]
  );

  const initiateGroupCall = useCallback(
    async (
      participantIds: number[],
      callerName: string,
      conversationId: string,
      groupName: string,
      isVideoCall: boolean = false
    ) => {
      try {
        await connectVoiceService();
        setCalleeName(groupName);
        setShowCallScreen(true);
        if (isVideoCall) {
          try {
            await audioService.setAudioRoute('speaker');
            setAudioRoute('speaker');
            setIsSpeakerOn(true);
          } catch {}
        }
        await voiceCallService.initiateGroupCall(
          participantIds,
          callerName,
          conversationId,
          groupName,
          isVideoCall
        );
      } catch (error: any) {
        console.error('[CallProvider] initiateGroupCall error:', error);
      }
    },
    [connectVoiceService]
  );

  const acceptCall = useCallback(async () => {
    try {
      await audioService.stopRingtone();

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
      await audioService.stopRingtone();

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

  const cycleAudioOutput = useCallback(async () => {
    try {
      const newRoute = await audioService.cycleAudioOutput();
      setAudioRoute(newRoute);
      setIsSpeakerOn(newRoute === 'speaker');
    } catch (error) {
      console.error('[CallProvider] cycleAudioOutput error:', error);
    }
  }, []);

  const toggleSpeaker = useCallback(async () => {
    try {
      const newState = await audioService.toggleSpeaker();
      setIsSpeakerOn(newState);
      setAudioRoute(newState ? 'speaker' : 'earpiece');
    } catch (error) {
      console.error('[CallProvider] toggleSpeaker error:', error);
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    try {
      await voiceCallService.toggleCamera();
    } catch (error) {
      console.error('[CallProvider] toggleCamera error:', error);
    }
  }, []);

  const switchCamera = useCallback(async () => {
    try {
      await voiceCallService.switchCamera();
    } catch (error) {
      console.error('[CallProvider] switchCamera error:', error);
    }
  }, []);

  const upgradeToVideo = useCallback(async () => {
    try {
      await voiceCallService.upgradeToVideo();

      try {
        await audioService.setAudioRoute('speaker');
        setAudioRoute('speaker');
        setIsSpeakerOn(true);
      } catch {}
    } catch (error) {
      console.error('[CallProvider] upgradeToVideo error:', error);
    }
  }, []);

  const isInCall =
    callState.status === 'active' ||
    callState.status === 'ringing' ||
    callState.status === 'connecting';

  const minimizeCall = useCallback(() => {
    setIsCallMinimized(true);
  }, []);

  const restoreCall = useCallback(() => {
    setIsCallMinimized(false);
  }, []);

  useEffect(() => {
    if (!isInCall) {
      setIsCallMinimized(false);
    }
  }, [isInCall]);

  const remoteDisplayName = callState.isGroupCall
    ? callState.groupName || 'Group Call'
    : callState.remoteUserName ||
      (incomingCall ? incomingCall.callerName : null) ||
      calleeName ||
      'Unknown';

  const contextValue: CallContextValue = {
    callState,
    initiateCall,
    initiateGroupCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    cycleAudioOutput,
    toggleSpeaker,
    toggleCamera,
    switchCamera,
    upgradeToVideo,
    isSpeakerOn,
    audioRoute,
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
          isGroupCall={!!incomingCall.isGroup}
          isVideoCall={!!incomingCall.isVideoCall}
          groupName={incomingCall.groupName || undefined}
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
          onToggleSpeaker={cycleAudioOutput}
          onToggleCamera={toggleCamera}
          onSwitchCamera={switchCamera}
          onUpgradeToVideo={upgradeToVideo}
          onMinimize={minimizeCall}
          isSpeakerOn={isSpeakerOn}
          audioRoute={audioRoute}
        />
      )}
    </CallContext.Provider>
  );
}

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
