import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReduceMotion } from '../lib/useReduceMotion';

jest.mock('react', () => ({ ...jest.requireActual('react'), useSyncExternalStore: jest.fn((_subscribe: unknown, get: () => boolean) => get()) }));

test('同時に使う部品が増えてもOS購読は1つ。最後の解除後は残らず、古い非同期結果も捨てる', async () => {
  const remove = jest.fn();
  const add = jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove });
  let resolve: (value: boolean) => void = () => {};
  const initial = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
  useReduceMotion(); // Reactへ渡す購読関数とsnapshotを取り出す
  const [subscribe, snapshot] = (useSyncExternalStore as jest.Mock).mock.calls[0]!;
  const first = subscribe(jest.fn());
  const second = subscribe(jest.fn());
  expect(add).toHaveBeenCalledTimes(1);
  expect(snapshot()).toBe(true); // 未確認時は静止
  first();
  expect(remove).not.toHaveBeenCalled();
  second();
  expect(remove).toHaveBeenCalledTimes(1);
  resolve(false); // 既に離れた画面の問い合わせ結果
  await Promise.resolve();
  expect(snapshot()).toBe(true);
  for (let n = 0; n < 5; n++) {
    const off = subscribe(jest.fn());
    off();
  }
  expect(add).toHaveBeenCalledTimes(6);
  expect(remove).toHaveBeenCalledTimes(6);
  initial.mockRestore();
  add.mockRestore();
});
