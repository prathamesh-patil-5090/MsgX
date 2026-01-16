import { authenticatedFetch } from './loginApi';

export interface MessageSender {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
}

export interface MessageResponse {
  id: number;
  conversation: number;
  sender: MessageSender;
  content: string;
  message_type: string;
  reply_to: number | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessagesListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: MessageResponse[];
}

/**
 * Fetch messages for a conversation
 * @param conversationId - The conversation ID
 * @param page - Page number for pagination
 * @returns List of messages
 */
export const fetchMessages = async (
  conversationId: number,
  page: number = 1
): Promise<MessagesListResponse> => {
  try {
    console.log(`[messagesApi] Fetching messages for conversation ${conversationId}, page ${page}`);
    const response = await authenticatedFetch(
      `/chat/api/conversations/${conversationId}/messages/?page=${page}`,
      {
        method: 'GET',
      }
    );

    console.log(`[messagesApi] Response status:`, response.status);
    console.log(`[messagesApi] Response headers:`, response.headers);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[messagesApi] Failed to fetch messages:', errorData);
      throw new Error(errorData.detail || `Failed to fetch messages: ${response.status}`);
    }

    const rawText = await response.text();
    console.log(`[messagesApi] Raw response text:`, rawText);

    let data;
    try {
      data = JSON.parse(rawText);
      console.log(`[messagesApi] Parsed data type:`, typeof data);
      console.log(`[messagesApi] Parsed data:`, data);
      console.log(`[messagesApi] Is array?`, Array.isArray(data));
      console.log(`[messagesApi] Has results?`, data?.results !== undefined);
    } catch (parseError) {
      console.error('[messagesApi] JSON parse error:', parseError);
      throw new Error('Invalid JSON response from server');
    }

    // Handle different response formats
    if (Array.isArray(data)) {
      // API returned array directly
      console.log(`[messagesApi] Response is array, length: ${data.length}`);
      return {
        count: data.length,
        next: null,
        previous: null,
        results: data,
      };
    } else if (data.results && Array.isArray(data.results)) {
      // API returned paginated response with direct array
      console.log(`[messagesApi] Response has results array, length: ${data.results.length}`);
      return data as MessagesListResponse;
    } else if (data.results && data.results.messages && Array.isArray(data.results.messages)) {
      // API returned paginated response with nested messages array
      console.log(
        `[messagesApi] Response has nested messages array, length: ${data.results.messages.length}`
      );
      return {
        count: data.count || data.results.messages.length,
        next: data.next || null,
        previous: data.previous || null,
        results: data.results.messages,
      };
    } else {
      // Unexpected format
      console.error('[messagesApi] Unexpected API response format:', data);
      console.error('[messagesApi] Data keys:', Object.keys(data || {}));
      return {
        count: 0,
        next: null,
        previous: null,
        results: [],
      };
    }
  } catch (error) {
    console.error('[messagesApi] Error fetching messages:', error);
    throw error;
  }
};

/**
 * Mark a message as read
 * @param conversationId - The conversation ID
 * @param messageId - The message ID to mark as read
 */
export const markMessageAsRead = async (
  conversationId: number,
  messageId: number
): Promise<void> => {
  try {
    console.log(
      `[messagesApi] Marking message ${messageId} as read in conversation ${conversationId}`
    );
    const response = await authenticatedFetch(
      `/chat/api/conversations/${conversationId}/mark-read/${messageId}/`,
      {
        method: 'POST',
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[messagesApi] Failed to mark message as read:', errorData);
      throw new Error(errorData.detail || `Failed to mark message as read: ${response.status}`);
    }

    console.log('[messagesApi] Message marked as read successfully');
  } catch (error) {
    console.error('[messagesApi] Error marking message as read:', error);
    throw error;
  }
};

/**
 * Send a message via REST API (if not using WebSocket)
 * @param conversationId - The conversation ID
 * @param content - Message content
 * @param messageType - Message type (default: TEXT)
 * @returns Created message
 */
export const sendMessage = async (
  conversationId: number,
  content: string,
  messageType: string = 'TEXT'
): Promise<MessageResponse> => {
  try {
    const response = await authenticatedFetch(
      `/chat/api/conversations/${conversationId}/messages/`,
      {
        method: 'POST',
        body: JSON.stringify({
          content,
          message_type: messageType,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to send message: ${response.status}`);
    }

    const data: MessageResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
};

/**
 * Delete a message
 * @param conversationId - The conversation ID
 * @param messageId - The message ID to delete
 */
export const deleteMessage = async (conversationId: number, messageId: number): Promise<void> => {
  try {
    const response = await authenticatedFetch(
      `/chat/api/conversations/${conversationId}/messages/${messageId}/`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to delete message: ${response.status}`);
    }
  } catch (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
};

/**
 * Update a message
 * @param conversationId - The conversation ID
 * @param messageId - The message ID to update
 * @param content - New message content
 * @returns Updated message
 */
export const updateMessage = async (
  conversationId: number,
  messageId: number,
  content: string
): Promise<MessageResponse> => {
  try {
    const response = await authenticatedFetch(
      `/chat/api/conversations/${conversationId}/messages/${messageId}/`,
      {
        method: 'PUT',
        body: JSON.stringify({
          content,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to update message: ${response.status}`);
    }

    const data: MessageResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating message:', error);
    throw error;
  }
};
