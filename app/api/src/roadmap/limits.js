// ロードマップまわりの上限（契約 §3.3）。1 か所に置く。
export const GOAL_TEXT_MAX = 500;
export const MINUTES_PER_DAY = { min: 5, max: 600 };
export const MAX_GOALS_PER_USER = 20;

export const CANDIDATES_MAX = 3;
export const CANDIDATE_CHECKPOINTS = { min: 3, max: 6 };
export const OWN_CHECKPOINTS = { min: 3, max: 12 }; // 自作・直した後の個数
export const WHY_MAX = 300;
export const NOTE_MAX = 200; // 案を作り直す時の本人の希望（#223）

export const LABEL_MAX = 30;
export const SUMMARY_MAX = 200;
export const TITLE_MAX = 100;
export const DONE_MARK_MAX = 200;
export const ESTIMATE_MIN = { min: 1, max: 6000 }; // 分

// 取り込んだ課題をタスクにする（POST /api/goals/import・#261）
export const IMPORT_ITEMS = { min: 1, max: 10 };
export const IMPORT_TITLE_MAX = 200;
export const IMPORT_NOTES_MAX = 500;
export const IMPORT_MINUTES = { min: 5, max: 600 };
export const TASK_DEFAULT_MIN = 30; // 見積りが無い時の既定のロードマップの見積り
export const TASK_DONE_MARK = '終わった';
