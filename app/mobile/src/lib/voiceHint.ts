// 声のふりかえりの、エラーを出す位置の判断（画面に依存しない関数だけ。試験できるように）。
// 「長押し」の案内は #255 でやめた（押して始め、もう一度押して止める）。

// マイクのエラーは写真の列の直下に、それ以外のエラーは今までどおり下に出す
export function errorPlace(micError: string | null, error: string | null): { near: string | null; bottom: string | null } {
  return { near: micError, bottom: error };
}

// 「あとで振り返る」を出すか。マイクのエラーは送れていないので出さない（他の条件は今までどおり）
export function showLater(args: { error: string | null; micError: string | null; phase: string }): boolean {
  return args.error !== null && args.micError === null && args.phase === 'input';
}
