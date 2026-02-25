import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatCallDuration, type CallState } from '../services/voiceCallService';

interface VoiceCallScreenProps {
  visible: boolean;
  callState: CallState;
  remoteUserName: string;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onMinimize: () => void;
  isSpeakerOn: boolean;
}

export default function VoiceCallScreen({
  visible,
  callState,
  remoteUserName,
  onEndCall,
  onToggleMute,
  onToggleSpeaker,
  onMinimize,
  isSpeakerOn,
}: VoiceCallScreenProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const dotAnim1 = useRef(new Animated.Value(0)).current;
  const dotAnim2 = useRef(new Animated.Value(0)).current;
  const dotAnim3 = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    // Fade in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Pulse animation for avatar during ringing/connecting
    let pulseLoop: Animated.CompositeAnimation | null = null;
    if (callState.status === 'ringing' || callState.status === 'connecting') {
      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoop.start();
    } else {
      pulseAnim.setValue(1);
    }

    // Dot animation for "Calling..." or "Connecting..."
    let dotLoop: Animated.CompositeAnimation | null = null;
    if (callState.status === 'ringing' || callState.status === 'connecting') {
      dotLoop = Animated.loop(
        Animated.stagger(200, [
          Animated.sequence([
            Animated.timing(dotAnim1, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(dotAnim1, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(dotAnim2, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(dotAnim2, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(dotAnim3, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(dotAnim3, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      dotLoop.start();
    }

    // Wave animation for active call
    let waveLoop: Animated.CompositeAnimation | null = null;
    if (callState.status === 'active') {
      waveLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(waveAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );
      waveLoop.start();
    }

    return () => {
      pulseLoop?.stop();
      dotLoop?.stop();
      waveLoop?.stop();
    };
  }, [visible, callState.status, pulseAnim, fadeAnim, dotAnim1, dotAnim2, dotAnim3, waveAnim]);

  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getStatusText = (): string => {
    switch (callState.status) {
      case 'connecting':
        return 'Connecting';
      case 'ringing':
        return 'Ringing';
      case 'active':
        return formatCallDuration(callState.duration);
      case 'ended':
        return 'Call Ended';
      case 'rejected':
        return 'Call Declined';
      case 'missed':
        return 'No Answer';
      case 'error':
        return callState.error || 'Call Failed';
      default:
        return '';
    }
  };

  const getStatusColor = (): string => {
    switch (callState.status) {
      case 'active':
        return '#4ade80';
      case 'ringing':
      case 'connecting':
        return '#facc15';
      case 'ended':
        return '#a1a1b5';
      case 'rejected':
      case 'error':
        return '#f87171';
      case 'missed':
        return '#fb923c';
      default:
        return '#a1a1b5';
    }
  };

  const isCallActive = callState.status === 'active';
  const isCallPending = callState.status === 'ringing' || callState.status === 'connecting';
  const isCallFinished =
    callState.status === 'ended' ||
    callState.status === 'rejected' ||
    callState.status === 'missed' ||
    callState.status === 'error';

  const showEndButton = isCallActive || isCallPending;
  const showControls = isCallActive || isCallPending;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent>
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        {/* Background */}
        <View style={styles.background} />

        {/* Top status bar area */}
        <View style={styles.topBar}>
          {/* Minimize Button */}
          {showControls && (
            <TouchableOpacity
              style={styles.minimizeButton}
              onPress={onMinimize}
              activeOpacity={0.7}>
              <Ionicons name="chevron-down" size={28} color="#a1a1b5" />
            </TouchableOpacity>
          )}

          <View style={styles.encryptionBadge}>
            <Ionicons name="lock-closed" size={12} color="#6b7280" />
            <Text style={styles.encryptionText}>End-to-end encrypted</Text>
          </View>
        </View>

        {/* Center Section */}
        <View style={styles.centerSection}>
          {/* Avatar */}
          <View style={styles.avatarWrapper}>
            {/* Active call wave indicator */}
            {isCallActive && (
              <Animated.View
                style={[
                  styles.activeRing,
                  {
                    opacity: waveAnim.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.15, 0.35, 0.15],
                    }),
                    transform: [
                      {
                        scale: waveAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.25],
                        }),
                      },
                    ],
                  },
                ]}
              />
            )}

            {/* Ringing pulse */}
            {isCallPending && (
              <Animated.View
                style={[
                  styles.pendingRing,
                  {
                    transform: [{ scale: pulseAnim }],
                  },
                ]}
              />
            )}

            <Animated.View
              style={[
                styles.avatar,
                isCallActive && styles.avatarActive,
                isCallFinished && styles.avatarFinished,
                { transform: [{ scale: pulseAnim }] },
              ]}>
              <Text style={styles.avatarText}>{getInitials(remoteUserName)}</Text>
            </Animated.View>
          </View>

          {/* Name */}
          <Text style={styles.userName}>{remoteUserName}</Text>

          {/* Status */}
          <View style={styles.statusContainer}>
            {isCallPending && (
              <View style={styles.dotsContainer}>
                <Text style={[styles.statusText, { color: getStatusColor() }]}>
                  {getStatusText()}
                </Text>
                <Animated.Text style={[styles.dot, { color: getStatusColor(), opacity: dotAnim1 }]}>
                  .
                </Animated.Text>
                <Animated.Text style={[styles.dot, { color: getStatusColor(), opacity: dotAnim2 }]}>
                  .
                </Animated.Text>
                <Animated.Text style={[styles.dot, { color: getStatusColor(), opacity: dotAnim3 }]}>
                  .
                </Animated.Text>
              </View>
            )}

            {!isCallPending && (
              <Text style={[styles.statusText, { color: getStatusColor() }]}>
                {getStatusText()}
              </Text>
            )}

            {callState.isPeerMuted && isCallActive && (
              <View style={styles.peerMutedBadge}>
                <Ionicons name="mic-off" size={12} color="#fb923c" />
                <Text style={styles.peerMutedText}>{remoteUserName.split(' ')[0]} is muted</Text>
              </View>
            )}
          </View>
        </View>

        {/* Bottom Controls */}
        <View style={styles.bottomSection}>
          {/* Control Buttons Row - shown during active AND pending states */}
          {showControls && (
            <View style={styles.controlsRow}>
              {/* Mute Button */}
              <View style={styles.controlContainer}>
                <TouchableOpacity
                  style={[styles.controlButton, callState.isMuted && styles.controlButtonActive]}
                  onPress={onToggleMute}
                  activeOpacity={0.7}>
                  <Ionicons
                    name={callState.isMuted ? 'mic-off' : 'mic'}
                    size={26}
                    color={callState.isMuted ? '#dc2626' : '#fff'}
                  />
                </TouchableOpacity>
                <Text style={[styles.controlLabel, callState.isMuted && styles.controlLabelActive]}>
                  {callState.isMuted ? 'Unmute' : 'Mute'}
                </Text>
              </View>

              {/* Speaker Button */}
              <View style={styles.controlContainer}>
                <TouchableOpacity
                  style={[styles.controlButton, isSpeakerOn && styles.controlButtonSpeakerActive]}
                  onPress={onToggleSpeaker}
                  activeOpacity={0.7}>
                  <MaterialCommunityIcons
                    name={isSpeakerOn ? 'volume-high' : 'volume-medium'}
                    size={26}
                    color={isSpeakerOn ? '#4ade80' : '#fff'}
                  />
                </TouchableOpacity>
                <Text
                  style={[styles.controlLabel, isSpeakerOn && styles.controlLabelSpeakerActive]}>
                  {isSpeakerOn ? 'Speaker On' : 'Speaker'}
                </Text>
              </View>

              {/* Bluetooth Button */}
              <View style={styles.controlContainer}>
                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={onToggleSpeaker}
                  activeOpacity={0.7}>
                  <MaterialCommunityIcons name="bluetooth-audio" size={26} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.controlLabel}>Bluetooth</Text>
              </View>
            </View>
          )}

          {/* End Call Button - always visible when call screen is shown */}
          {showEndButton && (
            <View style={styles.endCallContainer}>
              <TouchableOpacity
                style={styles.endCallButton}
                onPress={onEndCall}
                activeOpacity={0.7}>
                <Ionicons
                  name="call"
                  size={34}
                  color="#fff"
                  style={{ transform: [{ rotate: '135deg' }] }}
                />
              </TouchableOpacity>
              <Text style={styles.endCallLabel}>{isCallPending ? 'Cancel' : 'End Call'}</Text>
            </View>
          )}

          {/* Finished state indicator */}
          {isCallFinished && (
            <View style={styles.finishedContainer}>
              <Ionicons
                name={
                  callState.status === 'rejected'
                    ? 'close-circle'
                    : callState.status === 'missed'
                      ? 'alert-circle'
                      : callState.status === 'error'
                        ? 'warning'
                        : 'checkmark-circle'
                }
                size={40}
                color={getStatusColor()}
              />
              <Text style={[styles.finishedText, { color: getStatusColor() }]}>
                {callState.status === 'ended' &&
                  `Duration: ${formatCallDuration(callState.duration)}`}
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a1a',
  },
  topBar: {
    paddingTop: 56,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  minimizeButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 40,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  encryptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  encryptionText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  centerSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  avatarWrapper: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  activeRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#4ade80',
  },
  pendingRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: '#facc15',
    opacity: 0.3,
  },
  avatar: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4A9EFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 10,
  },
  avatarActive: {
    backgroundColor: '#1d4ed8',
    shadowColor: '#4ade80',
    shadowOpacity: 0.3,
  },
  avatarFinished: {
    backgroundColor: '#374151',
    shadowOpacity: 0,
  },
  avatarText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
  },
  userName: {
    fontSize: 30,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  statusContainer: {
    alignItems: 'center',
    minHeight: 50,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 17,
    fontWeight: '500',
  },
  dot: {
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 2,
  },
  peerMutedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 146, 60, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 12,
    gap: 6,
  },
  peerMutedText: {
    fontSize: 13,
    color: '#fb923c',
    fontWeight: '500',
  },
  bottomSection: {
    paddingBottom: 60,
    alignItems: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 40,
    gap: 48,
  },
  controlContainer: {
    alignItems: 'center',
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonActive: {
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.4)',
  },
  controlButtonSpeakerActive: {
    backgroundColor: 'rgba(74, 222, 128, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.4)',
  },
  controlLabel: {
    fontSize: 12,
    color: '#a1a1b5',
    marginTop: 8,
    fontWeight: '500',
  },
  controlLabelActive: {
    color: '#f87171',
  },
  controlLabelSpeakerActive: {
    color: '#4ade80',
  },
  endCallContainer: {
    alignItems: 'center',
  },
  endCallButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  endCallLabel: {
    fontSize: 14,
    color: '#f87171',
    marginTop: 12,
    fontWeight: '500',
  },
  finishedContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  finishedText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
