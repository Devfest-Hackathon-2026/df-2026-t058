// 集中中に、選んだ他のアプリを開けなくする窓口。今は何もしない仮の実装だけ。
// ネイティブの実装の方針は focusLock/README.md。画面はこの 3 つだけを呼ぶ。

export interface FocusLock {
  isAvailable(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const noopFocusLock: FocusLock = {
  async isAvailable() {
    return false;
  },
  async start() {},
  async stop() {},
};

export const focusLock: FocusLock = noopFocusLock;
