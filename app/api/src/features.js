// 各機能の差し込み口の一覧。新しい機能を足す時だけここを触る（I-1 が用意した 7 つで足りる）。
import { register as auth } from './auth/routes.js'; // I-2
import { register as roadmap } from './roadmap/routes.js'; // I-3
import { register as session } from './session/routes.js'; // I-4
import { register as tutor } from './tutor/routes.js'; // I-5
import { register as score } from './score/routes.js'; // I-6
import { register as friends } from './friends/routes.js'; // I-7
import { register as reflect } from './reflect/routes.js'; // I-8
import { register as home } from './home/routes.js'; // ホーム用（契約の変更点 §5）
import { register as agent } from './agent/routes.js'; // モルティと話す（§3.12・#307）

export const features = [auth, roadmap, session, tutor, score, friends, reflect, home, agent];
