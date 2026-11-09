// 友達（友達タブ）。自分のコード、コードで申請、届いた申請の承認、いま集中しているか、始めた知らせ。
// 自分の名前はここ 1 か所で変える（設定には置かない）。通知の強さは設定（右上の歯車）へ。

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, errorText } from '../../api';
import type { FeedItem, FriendEntry, User } from '../../api/types';
import { Avatar, ErrorBox, Skeleton } from '../../components/State';
import { BigButton, Chip, Field, Label, Screen } from '../../components/ui';
import { NAME_MAX, NAME_PLACEHOLDER, canSaveName, validName } from '../../lib/settingsForm';
import { COPY_DISPLAY_NAME, COPY_FRIEND_ACTIVE, COPY_FRIEND_FEED, friendStatsText } from '../../lib/copy';
import { useLoad } from '../../lib/useLoad';
import { color, font, radius, space } from '../../theme';

// 名前を付けていない人（サーバーの初期値は空）の見え方
const nameOf = (displayName: string) => displayName || '名前なし';

const timeText = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

import { useTabTitle } from '../../lib/tabTitle';

export default function Friends() {
  useTabTitle('友達');
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const [me, f, feed] = await Promise.all([api.me(), api.friends(), api.feed()]);
    return { me, friends: f.friends, feed: feed.items };
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const savedName = data?.me.displayName ?? '';
  useEffect(() => setName(savedName), [savedName]);

  // コピー。Web はブラウザのクリップボード。使えない所（ネイティブ）では、コードを長押しで選べる
  async function copyCode(text: string) {
    try {
      const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
      if (!nav?.clipboard?.writeText) return;
      await nav.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // コピーできなかった時は何も変えない（長押しで選べる）
    }
  }

  async function saveName() {
    const t = validName(name);
    if (!t) return;
    setSavingName(true);
    setMsg(null);
    setFail(null);
    try {
      const me: User = await api.updateMe({ displayName: t });
      setData((d) => (d ? { ...d, me } : d));
    } catch (e) {
      setFail(errorText(e));
    } finally {
      setSavingName(false);
    }
  }

  async function add() {
    setBusy(true);
    setMsg(null);
    setFail(null);
    try {
      await api.addFriend(code.trim().toUpperCase());
      setCode('');
      setMsg('申請した');
      await reload();
    } catch (e) {
      setFail(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function accept(id: string) {
    try {
      await api.acceptFriend(id);
      await reload();
    } catch (e) {
      setFail(errorText(e));
    }
  }

  const me = data?.me;
  const incoming = (data?.friends ?? []).filter((f) => f.friendship.status === 'pending' && f.friendship.friendId === me?.id);
  const outgoing = (data?.friends ?? []).filter((f) => f.friendship.status === 'pending' && f.friendship.userId === me?.id);
  const accepted = (data?.friends ?? []).filter((f) => f.friendship.status === 'accepted');

  // 自分の名前。友達の画面と知らせに出る。いつでもここで変えられる（名前を変える場所はここだけ）
  const nameBlock =
    me ? (
      <View style={styles.nameBlock}>
        <Field
          label={COPY_DISPLAY_NAME}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          placeholder={NAME_PLACEHOLDER}
          testID="my-name"
        />
        {canSaveName(name, savedName) ? (
          <BigButton label="名前を保存" variant="plain" busy={savingName} onPress={saveName} testID="save-name" />
        ) : null}
      </View>
    ) : null;

  return (
    <Screen>
      <ErrorBox text={error} onRetry={() => void reload()} />
      {!data && loading ? (
        <View style={{ gap: space.lg }} testID="friends-loading">
          <Skeleton height={56} />
          <View style={styles.list}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.person, i > 0 && styles.divider]}>
                <Skeleton width={40} height={40} radius={radius.full} />
                <Skeleton width={120} height={16} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {incoming.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>届いた申請</Label>
          <View style={styles.list}>
            {incoming.map((f, i) => (
              <View key={f.friendship.id} style={[styles.person, i > 0 && styles.divider]}>
                <Text style={styles.name}>{nameOf(f.user.displayName)}</Text>
                <BigButton label="承認" size="small" onPress={() => accept(f.friendship.id)} style={{ marginLeft: 'auto' }} />
              </View>
            ))}
          </View>
        </View>
      ) : null}


      {accepted.length + outgoing.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>友達</Label>
          <View style={styles.list}>
            {accepted.map((f, i) => (
              <Person key={f.friendship.id} f={f} first={i === 0} />
            ))}
            {outgoing.map((f, i) => (
              <View key={f.friendship.id} style={[styles.person, (accepted.length > 0 || i > 0) && styles.divider]}>
                <Text style={[styles.name, { color: color.muted }]}>{nameOf(f.user.displayName)}</Text>
                <Text style={styles.sub}>申請中</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {data && data.feed.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>{COPY_FRIEND_FEED}</Label>
          {data.feed.map((it: FeedItem, i: number) => (
            <View key={`${it.userId}-${it.at}-${i}`} style={styles.feedRow}>
              <Text style={styles.feedTime}>{timeText(it.at)}</Text>
              <Text style={styles.feedText}>{`${nameOf(it.displayName)}  ${it.oneLine}`}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.addBlock}>
        {me ? (
          <View style={styles.myCode}>
            <Label>自分のコード</Label>
            <View style={styles.codeRow}>
              <Text selectable style={styles.code} testID="my-code">
                {me.friendCode}
              </Text>
              <Chip label={copied ? '✓' : 'コピー'} selected={copied} onPress={() => void copyCode(me.friendCode)} testID="copy-code" />
            </View>
          </View>
        ) : !data && loading ? (
          <Skeleton height={64} testID="code-skeleton" />
        ) : null}
        <Field
          label="友達のコード"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          placeholder="ABC123"
          testID="friend-code"
        />
        <BigButton label="申請する" variant="plain" disabled={code.trim().length < 6 || !!error} busy={busy} onPress={add} />
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
        {fail ? (
          <Text accessibilityRole="alert" style={styles.fail} testID="friend-error">
            {fail}
          </Text>
        ) : null}
      </View>
      {/* 表示名は一度決めれば変えないので、一番下へ */}
      {nameBlock}
    </Screen>
  );
}

function Person(props: { f: FriendEntry; first: boolean }) {
  const { f } = props;
  // 順位は付けない。並びも変えない（並べ替えない）
  const stats = friendStatsText(f.floors, f.streak);
  return (
    <View style={[styles.person, !props.first && styles.divider]}>
      <Avatar name={nameOf(f.user.displayName)} active={f.activeNow} />
      <Text style={styles.name}>{nameOf(f.user.displayName)}</Text>
      <View style={styles.right}>
        {f.activeNow ? <Text style={styles.now}>{COPY_FRIEND_ACTIVE}</Text> : null}
        {stats ? (
          <Text style={styles.stats} testID="friend-stats">
            {stats}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: font.code, fontWeight: '900', letterSpacing: 4, color: color.primary },
  // 友達を足す所は、区切り線の下にまとめる（使う回数が少ないので下へ）
  addBlock: { gap: space.md, borderTopWidth: 2, borderTopColor: color.line, paddingTop: space.lg },
  myCode: { gap: space.xs },
  nameBlock: { gap: space.sm },
  msg: { fontSize: font.body, color: color.muted, fontWeight: '700' },
  fail: { fontSize: font.body, color: color.danger, fontWeight: '700' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  empty: { fontSize: font.body, color: color.muted, fontWeight: '700' },
  // 人の並びは札を重ねず、1 枚の中に区切り線で並べる
  list: {
    backgroundColor: color.surface,
    borderWidth: 2,
    borderColor: color.line,
    borderRadius: radius.box,
    paddingHorizontal: space.md,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    minHeight: 64,
  },
  divider: { borderTopWidth: 1, borderTopColor: color.line },
  name: { fontSize: font.body, fontWeight: '800', color: color.text },
  sub: { fontSize: font.small, color: color.muted, marginLeft: 'auto', fontWeight: '700' },
  now: { fontSize: font.small, color: color.primary, fontWeight: '800' },
  // 右寄せの列（取り組み中・階数と連続日数）
  right: { marginLeft: 'auto', alignItems: 'flex-end', gap: 2 },
  stats: { fontSize: font.small, color: color.muted, fontWeight: '700' },
  feedRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  feedTime: { width: 48, fontSize: font.small, color: color.muted, fontWeight: '700' },
  feedText: { flex: 1, fontSize: font.body, color: color.text },
});
