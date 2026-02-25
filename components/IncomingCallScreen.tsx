import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface IncomingCallScreenProps {
  callerName: string;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCallScreen({
  callerName,
  onAccept,
  onReject,
}: IncomingCallScreenProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideUpAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const ringPulse1 = useRef(new Animated.Value(0.4)).current;
  const ringPulse2 = useRef(new Animated.Value(0.4)).current;
  const ringScale1 = useRef(new Animated.Value(1)).current;
  const ringScale2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Slide up animation
    Animated.spring(slideUpAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 50,
      friction: 9,
    }).start();

    // Pulsing avatar animation
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    // Ring pulse animations
    const ringLoop1 = Animated.loop(
      Animated.parallel([
        Animated.timing(ringScale1, {
          toValue: 2.2,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse1, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    ringLoop1.start();

    const ringTimeout = setTimeout(() => {
      const ringLoop2 = Animated.loop(
        Animated.parallel([
          Animated.timing(ringScale2, {
            toValue: 2.2,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(ringPulse2, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      );
      ringLoop2.start();
    }, 500);

    return () => {
      pulseLoop.stop();
      ringLoop1.stop();
      clearTimeout(ringTimeout);
    };
  }, [pulseAnim, slideUpAnim, ringPulse1, ringPulse2, ringScale1, ringScale2]);

  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideUpAnim }] }]}>
      {/* Background gradient effect */}
      <View style={styles.backgroundOverlay} />

      {/* Top Section */}
      <View style={styles.topSection}>
        <Text style={styles.incomingLabel}>Incoming Voice Call</Text>

        {/* Avatar with pulse rings */}
        <View style={styles.avatarContainer}>
          {/* Pulse Ring 1 */}
          <Animated.View
            style={[
              styles.pulseRing,
              {
                opacity: ringPulse1,
                transform: [{ scale: ringScale1 }],
              },
            ]}
          />
          {/* Pulse Ring 2 */}
          <Animated.View
            style={[
              styles.pulseRing,
              {
                opacity: ringPulse2,
                transform: [{ scale: ringScale2 }],
              },
            ]}
          />
          {/* Avatar */}
          <Animated.View style={[styles.avatar, { transform: [{ scale: pulseAnim }] }]}>
            <Text style={styles.avatarText}>{getInitials(callerName)}</Text>
          </Animated.View>
        </View>

        <Text style={styles.callerName}>{callerName}</Text>
        <Text style={styles.callerSubtext}>Voice Call</Text>
      </View>

      {/* Bottom Section - Action Buttons */}
      <View style={styles.bottomSection}>
        {/* Reject Button */}
        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={onReject}
            activeOpacity={0.7}>
            <Ionicons
              name="call"
              size={32}
              color="#fff"
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Decline</Text>
        </View>

        {/* Accept Button */}
        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={onAccept}
            activeOpacity={0.7}>
            <Ionicons name="call" size={32} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Accept</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a1a',
  },
  topSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  incomingLabel: {
    fontSize: 16,
    color: '#8b8ba3',
    fontWeight: '500',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 40,
  },
  avatarContainer: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: '#4A9EFF',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4A9EFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  avatarText: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#fff',
  },
  callerName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  callerSubtext: {
    fontSize: 16,
    color: '#8b8ba3',
    fontWeight: '400',
  },
  bottomSection: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingBottom: 80,
    paddingHorizontal: 40,
  },
  actionContainer: {
    alignItems: 'center',
  },
  actionButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  rejectButton: {
    backgroundColor: '#dc2626',
    shadowColor: '#dc2626',
  },
  acceptButton: {
    backgroundColor: '#16a34a',
    shadowColor: '#16a34a',
  },
  actionLabel: {
    fontSize: 14,
    color: '#a1a1b5',
    marginTop: 12,
    fontWeight: '500',
  },
});
