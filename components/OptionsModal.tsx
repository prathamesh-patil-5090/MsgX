import { Entypo, MaterialIcons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

type OptionsModalType = {
  messageId: string;
  onEdit: (messageId: string) => void;
  onDelete: (messageId: string) => void;
};

export default function OptionsModal({ messageId, onEdit, onDelete }: OptionsModalType) {
  return (
    <View className="border-1 flex flex-row items-end justify-end gap-1 rounded-xl border border-white bg-black p-2">
      <Pressable onPress={() => onEdit?.(messageId)}>
        <Entypo name="edit" size={16} color="white" />
      </Pressable>
      <Pressable onPress={() => onDelete?.(messageId)}>
        <MaterialIcons name="delete" size={16} color="white" />
      </Pressable>
    </View>
  );
}
