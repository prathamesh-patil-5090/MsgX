import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import {
  formatCallDuration,
  type CallState,
  type GroupParticipant,
} from '../services/voiceCallService';
import { type AudioOutputRoute } from '../services/audioService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface VoiceCallScreenProps {
  visible: boolean;
  callState: CallState;
  remoteUserName: string;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onUpgradeToVideo: () => void;
  onMinimize: () => void;
  isSpeakerOn: boolean;
  audioRoute: AudioOutputRoute;
}

export default function VoiceCallScreen({
  visible,
  callState,
  remoteUserName,
  onEndCall,
  onToggleMute,
  onToggleSpeaker,
  onToggleCamera,
  onSwitchCamera,
  onUpgradeToVideo,
  onMinimize,
  isSpeakerOn,
  audioRoute,
}: VoiceCallScreenProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const dotAnim1 = useRef(new Animated.Value(0)).current;
  const dotAnim2 = useRef(new Animated.Value(0)).current;
  const dotAnim3 = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

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
        return callState.error || 'Connecting';
      case 'ringing':
        return callState.error || 'Ringing';
      case 'active':
        if (callState.error) return callState.error;
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
        return callState.error ? '#facc15' : '#4ade80';
      case 'ringing':
      case 'connecting':
        return callState.error ? '#fb923c' : '#facc15';
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

        {/* ── Remote Video (full-screen behind everything) ── */}
        {callState.isVideoCall && callState.remoteVideoStreamURL && callState.isPeerCameraOn && (
          <RTCView
            streamURL={callState.remoteVideoStreamURL}
            style={styles.remoteVideo}
            objectFit="cover"
            zOrder={0}
          />
        )}

        {/* ── Local Video PIP ── */}
        {callState.isVideoCall && callState.localVideoStreamURL && callState.isCameraOn && (
          <View style={styles.localVideoPip}>
            <RTCView
              streamURL={callState.localVideoStreamURL}
              style={styles.localVideoStream}
              objectFit="cover"
              mirror={callState.isFrontCamera}
              zOrder={1}
            />
            {/* Switch Camera overlay button */}
            <TouchableOpacity
              style={styles.switchCameraButton}
              onPress={onSwitchCamera}
              activeOpacity={0.7}>
              <Ionicons name="camera-reverse-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

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
          {callState.isGroupCall ? (
            <>
              {/* Group name */}
              <Text style={styles.userName}>{remoteUserName}</Text>

              {/* Status */}
              <View style={styles.statusContainer}>
                {isCallPending && (
                  <View style={styles.dotsContainer}>
                    <Text style={[styles.statusText, { color: getStatusColor() }]}>
                      {getStatusText()}
                    </Text>
                    <Animated.Text
                      style={[styles.dot, { color: getStatusColor(), opacity: dotAnim1 }]}>
                      .
                    </Animated.Text>
                    <Animated.Text
                      style={[styles.dot, { color: getStatusColor(), opacity: dotAnim2 }]}>
                      .
                    </Animated.Text>
                    <Animated.Text
                      style={[styles.dot, { color: getStatusColor(), opacity: dotAnim3 }]}>
                      .
                    </Animated.Text>
                  </View>
                )}
                {!isCallPending && (
                  <Text style={[styles.statusText, { color: getStatusColor() }]}>
                    {getStatusText()}
                  </Text>
                )}
              </View>

              {/* Participant count */}
              {isCallActive && (
                <Text style={styles.participantCount}>
                  {callState.participants.filter((p) => p.status === 'active').length + 1}{' '}
                  participants
                </Text>
              )}

              {/* Participants grid */}
              <ScrollView
                contentContainerStyle={styles.participantsGrid}
                showsVerticalScrollIndicator={false}
                style={styles.participantsScroll}>
                {callState.participants
                  .filter((p) => p.status === 'active' || p.status === 'ringing')
                  .map((participant) => (
                    <View key={participant.userId} style={styles.participantItem}>
                      <View
                        style={[
                          styles.participantAvatar,
                          participant.status === 'active'
                            ? styles.participantAvatarActive
                            : styles.participantAvatarRinging,
                        ]}>
                        <Text style={styles.participantAvatarText}>
                          {getInitials(participant.userName)}
                        </Text>
                        {participant.isMuted && (
                          <View style={styles.participantMuteIcon}>
                            <Ionicons name="mic-off" size={10} color="#fb923c" />
                          </View>
                        )}
                      </View>
                      <Text style={styles.participantName} numberOfLines={1}>
                        {participant.userName.split(' ')[0]}
                      </Text>
                      {participant.status === 'ringing' && (
                        <Text style={styles.participantRinging}>Ringing...</Text>
                      )}
                    </View>
                  ))}
              </ScrollView>
            </>
          ) : (
            <>
              {/* Avatar */}
              <View style={styles.avatarWrapper}>
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
                {isCallPending && (
                  <Animated.View
                    style={[styles.pendingRing, { transform: [{ scale: pulseAnim }] }]}
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
                    <Animated.Text
                      style={[styles.dot, { color: getStatusColor(), opacity: dotAnim1 }]}>
                      .
                    </Animated.Text>
                    <Animated.Text
                      style={[styles.dot, { color: getStatusColor(), opacity: dotAnim2 }]}>
                      .
                    </Animated.Text>
                    <Animated.Text
                      style={[styles.dot, { color: getStatusColor(), opacity: dotAnim3 }]}>
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
                    <Text style={styles.peerMutedText}>
                      {remoteUserName.split(' ')[0]} is muted
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}
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

              {/* Camera Toggle - only for video calls */}
              {callState.isVideoCall && (
                <View style={styles.controlContainer}>
                  <TouchableOpacity
                    style={[
                      styles.controlButton,
                      !callState.isCameraOn && styles.controlButtonActive,
                    ]}
                    onPress={onToggleCamera}
                    activeOpacity={0.7}>
                    <Ionicons
                      name={callState.isCameraOn ? 'videocam' : 'videocam-off'}
                      size={26}
                      color={!callState.isCameraOn ? '#dc2626' : '#fff'}
                    />
                  </TouchableOpacity>
                  <Text
                    style={[
                      styles.controlLabel,
                      !callState.isCameraOn && styles.controlLabelActive,
                    ]}>
                    {callState.isCameraOn ? 'Cam On' : 'Cam Off'}
                  </Text>
                </View>
              )}

              {/* Audio Output Route Button (earpiece / speaker / bluetooth) */}
              {!callState.isVideoCall && (
                <View style={styles.controlContainer}>
                  <TouchableOpacity
                    style={[
                      styles.controlButton,
                      audioRoute === 'speaker' && styles.controlButtonSpeakerActive,
                      audioRoute === 'bluetooth' && styles.controlButtonBluetoothActive,
                    ]}
                    onPress={onToggleSpeaker}
                    activeOpacity={0.7}>
                    <MaterialCommunityIcons
                      name={
                        audioRoute === 'bluetooth'
                          ? 'bluetooth-audio'
                          : audioRoute === 'speaker'
                            ? 'volume-high'
                            : 'phone-in-talk'
                      }
                      size={26}
                      color={
                        audioRoute === 'bluetooth'
                          ? '#60a5fa'
                          : audioRoute === 'speaker'
                            ? '#4ade80'
                            : '#fff'
                      }
                    />
                  </TouchableOpacity>
                  <Text
                    style={[
                      styles.controlLabel,
                      audioRoute === 'speaker' && styles.controlLabelSpeakerActive,
                      audioRoute === 'bluetooth' && styles.controlLabelBluetoothActive,
                    ]}>
                    {audioRoute === 'bluetooth'
                      ? 'Bluetooth'
                      : audioRoute === 'speaker'
                        ? 'Speaker'
                        : 'Earpiece'}
                  </Text>
                </View>
              )}

              {/* Upgrade to Video - ONLY for 1:1 voice calls (not group) */}
              {!callState.isVideoCall && !callState.isGroupCall && isCallActive && (
                <View style={styles.controlContainer}>
                  <TouchableOpacity
                    style={[styles.controlButton, styles.controlButtonUpgrade]}
                    onPress={onUpgradeToVideo}
                    activeOpacity={0.7}>
                    <Ionicons name="videocam" size={26} color="#60a5fa" />
                  </TouchableOpacity>
                  <Text style={[styles.controlLabel, { color: '#60a5fa' }]}>Video</Text>
                </View>
              )}

              {/* Camera Switch - for video calls */}
              {callState.isVideoCall && (
                <View style={styles.controlContainer}>
                  <TouchableOpacity
                    style={styles.controlButton}
                    onPress={onSwitchCamera}
                    activeOpacity={0.7}>
                    <Ionicons name="camera-reverse" size={26} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.controlLabel}>Flip</Text>
                </View>
              )}

              {/* Audio Output Route Button for video calls */}
              {callState.isVideoCall && (
                <View style={styles.controlContainer}>
                  <TouchableOpacity
                    style={[
                      styles.controlButton,
                      audioRoute === 'speaker' && styles.controlButtonSpeakerActive,
                      audioRoute === 'bluetooth' && styles.controlButtonBluetoothActive,
                    ]}
                    onPress={onToggleSpeaker}
                    activeOpacity={0.7}>
                    <MaterialCommunityIcons
                      name={
                        audioRoute === 'bluetooth'
                          ? 'bluetooth-audio'
                          : audioRoute === 'speaker'
                            ? 'volume-high'
                            : 'phone-in-talk'
                      }
                      size={26}
                      color={
                        audioRoute === 'bluetooth'
                          ? '#60a5fa'
                          : audioRoute === 'speaker'
                            ? '#4ade80'
                            : '#fff'
                      }
                    />
                  </TouchableOpacity>
                  <Text
                    style={[
                      styles.controlLabel,
                      audioRoute === 'speaker' && styles.controlLabelSpeakerActive,
                      audioRoute === 'bluetooth' && styles.controlLabelBluetoothActive,
                    ]}>
                    {audioRoute === 'bluetooth'
                      ? 'Bluetooth'
                      : audioRoute === 'speaker'
                        ? 'Speaker'
                        : 'Earpiece'}
                  </Text>
                </View>
              )}
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
  controlButtonBluetoothActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.4)',
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
  controlLabelBluetoothActive: {
    color: '#60a5fa',
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

  participantCount: {
    fontSize: 13,
    color: '#a1a1b5',
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 16,
  },
  participantsScroll: {
    maxHeight: 240,
    width: '100%',
  },
  participantsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 20,
  },
  participantItem: {
    alignItems: 'center',
    width: 72,
  },
  participantAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  participantAvatarActive: {
    backgroundColor: '#1d4ed8',
    borderWidth: 2,
    borderColor: '#4ade80',
  },
  participantAvatarRinging: {
    backgroundColor: '#374151',
    borderWidth: 2,
    borderColor: '#facc15',
    opacity: 0.7,
  },
  participantAvatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  participantMuteIcon: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantName: {
    fontSize: 12,
    color: '#d1d5db',
    fontWeight: '500',
    textAlign: 'center',
  },
  participantRinging: {
    fontSize: 10,
    color: '#facc15',
    fontWeight: '500',
    marginTop: 2,
  },

  remoteVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000',
  },
  localVideoPip: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 44,
    right: 16,
    width: 120,
    height: 170,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
    zIndex: 20,
    elevation: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  localVideoStream: {
    width: '100%',
    height: '100%',
  },
  switchCameraButton: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonUpgrade: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.4)',
  },
});
