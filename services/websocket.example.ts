/**
 * WebSocket Service - Example Usage
 *
 * This file demonstrates how to use the WebSocket service in different scenarios.
 */

import { websocketService, type WebSocketResponse } from './websocket';

// ============================================================================
// Example 1: Basic Connection and Message Sending
// ============================================================================

export const basicExample = async (conversationId: string) => {
  try {
    // Connect to WebSocket
    await websocketService.connect(conversationId);
    console.log('Connected to chat:', conversationId);

    // Send a simple text message
    websocketService.sendMessage('Hello, World!');
  } catch (error) {
    console.error('Failed to connect or send message:', error);
  }
};

// ============================================================================
// Example 2: Setting Up Message Handlers in a Component
// ============================================================================

export const useWebSocketExample = (conversationId: string) => {
  // In a React component, you would use useEffect:
  // useEffect(() => {
  //   setupWebSocket();
  //   return () => websocketService.disconnect();
  // }, [conversationId]);

  const setupWebSocket = async () => {
    try {
      // Connect
      await websocketService.connect(conversationId);

      // Handle incoming messages
      const unsubscribeMessage = websocketService.onMessage((data: WebSocketResponse) => {
        console.log('New message received:', {
          message: data.message,
          senderId: data.sender_id,
          tempId: data.temp_id,
        });

        // Update your state here
        // setMessages(prev => [...prev, newMessage]);
      });

      // Handle connection opened
      const unsubscribeOpen = websocketService.onOpen(() => {
        console.log('WebSocket connection established');
        // setConnectionStatus('connected');
      });

      // Handle connection closed
      const unsubscribeClose = websocketService.onClose(() => {
        console.log('WebSocket connection closed');
        // setConnectionStatus('disconnected');
      });

      // Handle errors
      const unsubscribeError = websocketService.onError((error) => {
        console.error('WebSocket error:', error);
        // Show error notification to user
      });

      // Return cleanup function
      return () => {
        unsubscribeMessage();
        unsubscribeOpen();
        unsubscribeClose();
        unsubscribeError();
        websocketService.disconnect();
      };
    } catch (error) {
      console.error('Setup failed:', error);
    }
  };

  return { setupWebSocket };
};

// ============================================================================
// Example 3: Checking Connection Status
// ============================================================================

export const checkConnectionExample = () => {
  // Check if connected
  const isConnected = websocketService.isConnected();
  console.log('Is connected:', isConnected);

  // Get detailed connection state
  const state = websocketService.getConnectionState();
  /*
   * Connection states (WebSocket readyState):
   * 0 = CONNECTING
   * 1 = OPEN
   * 2 = CLOSING
   * 3 = CLOSED
   * null = Not initialized
   */
  console.log('Connection state:', state);

  // Only send if connected
  if (isConnected) {
    websocketService.sendMessage('Message sent!');
  } else {
    console.log('Cannot send: Not connected');
  }
};

// ============================================================================
// Example 4: Handling Message Confirmation (Optimistic Updates)
// ============================================================================

export const optimisticUpdateExample = () => {
  const messages: any[] = [];

  const sendMessageWithOptimisticUpdate = (messageText: string) => {
    // Generate temporary ID
    const tempId = `temp_${Date.now()}_${Math.random()}`;

    // Add message to UI immediately (optimistic)
    const optimisticMessage = {
      id: tempId,
      text: messageText,
      sender: 'me',
      timestamp: new Date().toISOString(),
      temp_id: tempId,
      isPending: true, // Show loading/pending state
    };

    messages.push(optimisticMessage);
    console.log('Added optimistic message:', optimisticMessage);

    // Send via WebSocket
    try {
      websocketService.sendMessage(messageText);
    } catch (error) {
      console.error('Failed to send:', error);
      // Remove optimistic message on failure
      const index = messages.findIndex((m) => m.temp_id === tempId);
      if (index > -1) {
        messages.splice(index, 1);
      }
    }
  };

  // Handler for WebSocket responses
  const handleWebSocketResponse = (data: WebSocketResponse) => {
    // Find the pending message by temp_id
    const pendingMessage = messages.find((m) => m.temp_id === data.temp_id);

    if (pendingMessage) {
      // This is confirmation of our own message
      pendingMessage.isPending = false;
      pendingMessage.id = data.temp_id; // Update with server ID
      console.log('Message confirmed:', data);
    } else {
      // This is a new message from another user
      const newMessage = {
        id: data.temp_id,
        text: data.message,
        sender: 'other',
        timestamp: new Date().toISOString(),
        sender_id: data.sender_id,
      };
      messages.push(newMessage);
      console.log('Received new message from user:', data.sender_id);
    }
  };

  return { sendMessageWithOptimisticUpdate, handleWebSocketResponse };
};

// ============================================================================
// Example 5: Multiple Conversations (Switching Chats)
// ============================================================================

export const switchConversationExample = async (newConversationId: string) => {
  // The service automatically handles switching conversations
  // It will disconnect from the current conversation and connect to the new one

  console.log('Switching to conversation:', newConversationId);

  try {
    // This will automatically disconnect from old conversation if any
    await websocketService.connect(newConversationId);
    console.log('Successfully switched to new conversation');
  } catch (error) {
    console.error('Failed to switch conversation:', error);
  }
};

// ============================================================================
// Example 6: Error Handling and Retry Logic
// ============================================================================

export const errorHandlingExample = async (conversationId: string) => {
  const maxRetries = 3;
  let retryCount = 0;

  const connectWithRetry = async (): Promise<void> => {
    try {
      await websocketService.connect(conversationId);
      console.log('Connected successfully');
      retryCount = 0; // Reset on success
    } catch (error) {
      console.error('Connection failed:', error);

      if (retryCount < maxRetries) {
        retryCount++;
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        console.log(`Retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);

        setTimeout(() => {
          connectWithRetry();
        }, delay);
      } else {
        console.error('Max retries reached. Giving up.');
        // Show user-friendly error message
        // Alert.alert('Connection Error', 'Unable to connect to chat server');
      }
    }
  };

  // Note: The service already has built-in reconnection logic!
  // This is just an example of manual retry logic if needed
  await connectWithRetry();
};

// ============================================================================
// Example 7: Clean Disconnect
// ============================================================================

export const disconnectExample = () => {
  // Disconnect when user navigates away from chat
  // or logs out

  console.log('Disconnecting from WebSocket...');
  websocketService.disconnect();
  console.log('Disconnected');

  // The service will:
  // 1. Stop auto-reconnection attempts
  // 2. Close the WebSocket connection
  // 3. Clean up resources
};

// ============================================================================
// Example 8: Integration with React Component (Full Example)
// ============================================================================

/*
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList } from 'react-native';
import { websocketService, type WebSocketResponse } from 'services/websocket';

interface Message {
  id: string;
  text: string;
  sender: 'me' | 'other';
  isPending?: boolean;
}

export const ChatComponent = ({ conversationId }: { conversationId: string }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let mounted = true;

    const connectAndSetupHandlers = async () => {
      try {
        await websocketService.connect(conversationId);

        if (!mounted) return;

        // Message handler
        const unsubMessage = websocketService.onMessage((data: WebSocketResponse) => {
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === data.temp_id);
            if (existing) {
              // Update pending message
              return prev.map((m) =>
                m.id === data.temp_id ? { ...m, isPending: false } : m
              );
            } else {
              // New message from another user
              return [
                ...prev,
                {
                  id: data.temp_id,
                  text: data.message,
                  sender: 'other',
                },
              ];
            }
          });
        });

        // Connection status handlers
        const unsubOpen = websocketService.onOpen(() => setIsConnected(true));
        const unsubClose = websocketService.onClose(() => setIsConnected(false));
        const unsubError = websocketService.onError((error) => {
          console.error('WebSocket error:', error);
        });

        // Cleanup
        return () => {
          unsubMessage();
          unsubOpen();
          unsubClose();
          unsubError();
          websocketService.disconnect();
        };
      } catch (error) {
        console.error('Failed to connect:', error);
      }
    };

    connectAndSetupHandlers();

    return () => {
      mounted = false;
      websocketService.disconnect();
    };
  }, [conversationId]);

  const sendMessage = () => {
    if (!inputText.trim() || !isConnected) return;

    const tempId = `temp_${Date.now()}`;
    const newMessage: Message = {
      id: tempId,
      text: inputText.trim(),
      sender: 'me',
      isPending: true,
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText('');

    try {
      websocketService.sendMessage(newMessage.text);
    } catch (error) {
      console.error('Send failed:', error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Text>Status: {isConnected ? 'Connected' : 'Disconnected'}</Text>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Text>
            {item.sender === 'me' ? 'You' : 'Other'}: {item.text}
            {item.isPending && ' (Sending...)'}
          </Text>
        )}
      />

      <View style={{ flexDirection: 'row' }}>
        <TextInput
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
        />
        <Button title="Send" onPress={sendMessage} disabled={!isConnected} />
      </View>
    </View>
  );
};
*/

// ============================================================================
// Example 9: Type-Safe Message Types
// ============================================================================

// You can extend message types for different message kinds:

type MessageType = 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE' | 'VIDEO';

interface ExtendedMessage {
  message: string;
  message_type: MessageType;
  metadata?: {
    fileUrl?: string;
    fileName?: string;
    duration?: number;
    thumbnail?: string;
  };
}

export const sendExtendedMessage = (message: ExtendedMessage) => {
  // Note: Current WebSocket service only supports TEXT messages
  // You would need to update the backend and service to support other types

  if (message.message_type === 'TEXT') {
    websocketService.sendMessage(message.message);
  } else {
    console.warn('Non-text messages not yet supported');
    // Future implementation for images, files, etc.
  }
};
