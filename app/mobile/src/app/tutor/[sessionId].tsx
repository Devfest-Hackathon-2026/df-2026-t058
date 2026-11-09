// 相談。会話は components/TutorChat.tsx（集中の画面と同じ部品）。この画面は履歴を見る・深いリンク用に残す。

import { useLocalSearchParams } from 'expo-router';
import { TutorChat } from '../../components/TutorChat';
import { COPY_ASK_AI } from '../../lib/copy';
import { useTabTitle } from '../../lib/tabTitle';

export default function Tutor() {
  useTabTitle(COPY_ASK_AI);
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return <TutorChat sessionId={sessionId} />;
}
