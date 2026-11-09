// 保管の集まりの名前（全機能で共通。足す時は契約 §4 も）。
export const C = {
  users: 'users',
  goals: 'goals',
  roadmaps: 'roadmaps', // id = goalId（目標 1 つに 1 つ）
  candidateSets: 'candidate_sets', // id = goalId（AI の案。呼び直すと置き換え）
  sessions: 'sessions',
  events: 'events', // 追記のみ
  tutorState: 'tutor_state', // id = sessionId
  tutorMessages: 'tutor_messages',
  floors: 'floors', // id = sessionId（派生物・再計算で上書き）
  friendships: 'friendships',
  pushSubs: 'push_subs', // id = endpoint の sha256（端末への通知の登録・消す時は deletedAt を付ける）
  pushSent: 'push_sent', // id = userId（{ day, count }＝その日に送った数）
};
