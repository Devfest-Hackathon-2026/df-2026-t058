// API の窓口はここ 1 か所。画面は `api` だけを使い、fetch を直接呼ばない。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAuthSession, type AuthSession } from './auth';
import { readConfig } from './config';
import { getDevUserId } from './devUser';
import { createHttpApi } from './http';
import { createMockApi } from './mock';
import type { Api } from './types';

export const config = readConfig({
  EXPO_PUBLIC_API_MODE: process.env.EXPO_PUBLIC_API_MODE,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_MOCK_SPEED: process.env.EXPO_PUBLIC_MOCK_SPEED,
});

// 招待コードでのログイン（real モードだけ。mock にログインは無い）
export const session: AuthSession | null =
  config.mode === 'mock' ? null : createAuthSession({ baseUrl: config.baseUrl, storage: AsyncStorage });

export const api: Api =
  config.mode === 'mock'
    ? createMockApi({ speed: config.mockSpeed })
    : createHttpApi({ baseUrl: config.baseUrl, getUserId: getDevUserId, auth: session ?? undefined });

export { ApiError, errorText } from './errors';
export type * from './types';
