// 手元の紙（試験範囲・問題集のページなど）を写真で取り込む欄。写真は文字にして捨てる（画面にも残さない）。
// Web では PDF・テキストのファイルも足せる（#201）。ファイルも文字にして捨てる。
// 文字は本人が直せる。親には文字だけを渡す。

import { useReducer, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { api, errorText } from '../api';
import type { MaterialFile, ReflectImage } from '../api/types';
import {
  appendText,
  bytesToBase64,
  canPickFiles,
  FILE_ACCEPT,
  fileKind,
  fileProblem,
  materialsPhase,
  MAX_MATERIAL_FILES,
  MAX_MATERIALS,
} from '../lib/materialsState';
import { canUseCamera, MAX_PHOTOS, pickPhotos, preparePhoto } from '../lib/photo';
import { space } from '../theme';
import { BigButton, ErrorLine, Field, TextLink, ThinkingDots } from './ui';

type Pending = { images: ReflectImage[]; files: MaterialFile[] };

// Web のファイル選択（<input type="file">）を開く。取り消したら空の配列
function pickWebFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = FILE_ACCEPT;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []).slice(0, MAX_MATERIAL_FILES));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function MaterialsField(props: {
  label?: string;
  value: string;
  onChange: (text: string) => void;
  testID?: string;
}) {
  const { label = '資料', value, onChange, testID = 'materials' } = props;
  const [phase, dispatch] = useReducer(materialsPhase, 'idle');
  const [error, setError] = useState<string | null>(null);
  // 「もう一度」のために、読めなかった時だけメモリに持つ。画面には出さない
  const pending = useRef<Pending | null>(null);
  const latest = useRef(value);
  latest.current = value;

  function fail(message: string, input: Pending | null) {
    pending.current = input;
    dispatch({ type: 'fail' });
    setError(message);
  }

  async function read(input: Pending) {
    dispatch({ type: 'start' });
    setError(null);
    try {
      const { text } = await api.readMaterials(input.images, input.files);
      const next = appendText(latest.current, text);
      if (next === null) return fail('読み取れませんでした', input);
      pending.current = null;
      dispatch({ type: 'done' });
      onChange(next);
    } catch (e) {
      fail(errorText(e), input);
    }
  }

  async function add(mode: 'camera' | 'library') {
    setError(null);
    const images: ReflectImage[] = [];
    try {
      const picked = await pickPhotos(mode, MAX_PHOTOS);
      if (picked.length === 0) return;
      dispatch({ type: 'start' });
      for (const p of picked) images.push((await preparePhoto(p)).image);
    } catch {
      return fail('写真を読めませんでした', null);
    }
    await read({ images, files: [] });
  }

  async function addFiles() {
    setError(null);
    const files: MaterialFile[] = [];
    try {
      const picked = await pickWebFiles();
      if (picked.length === 0) return;
      for (const f of picked) {
        const problem = fileProblem(f); // 上限を超えたら送らずに 1 行
        if (problem) return fail(problem, null);
      }
      dispatch({ type: 'start' });
      for (const f of picked) {
        files.push({ mimeType: fileKind(f.name, f.type)!, dataBase64: bytesToBase64(new Uint8Array(await f.arrayBuffer())) });
      }
    } catch {
      return fail('ファイルを読めませんでした', null);
    }
    await read({ images: [], files });
  }

  return (
    <View style={styles.box}>
      <Field
        label={label}
        value={value}
        onChangeText={(t) => onChange(t.slice(0, MAX_MATERIALS))}
        placeholder="教科書 p.40〜52"
        multiline
        maxLength={MAX_MATERIALS}
        testID={`${testID}-text`}
      />
      {phase === 'reading' ? (
        <ThinkingDots label="読み取っています" />
      ) : (
        <View style={styles.row}>
          {canUseCamera ? (
            <BigButton label="撮る" variant="plain" size="small" onPress={() => add('camera')} style={styles.even} testID={`${testID}-camera`} />
          ) : null}
          <BigButton label="写真を足す" variant="plain" size="small" onPress={() => add('library')} style={styles.even} testID={`${testID}-add`} />
          {canPickFiles(Platform.OS) ? (
            <BigButton label="ファイルを足す" variant="plain" size="small" onPress={addFiles} style={styles.even} testID={`${testID}-file`} />
          ) : null}
        </View>
      )}
      <ErrorLine text={phase === 'failed' ? error : null} />
      {phase === 'failed' && pending.current ? (
        <TextLink label="もう一度" onPress={() => read(pending.current!)} testID={`${testID}-retry`} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  even: { flex: 1 },
});
