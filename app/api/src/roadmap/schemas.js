import { AXES } from './axes.js';

// ロードマップの見直しの出力（#358）。個数・範囲・文字数は revise.js で検査する。
export const REVISE_SCHEMA = {
  type: 'object',
  required: ['reply', 'draft'],
  properties: {
    reply: { type: 'string' },
    draft: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'doneMark', 'estimateMin'],
        properties: { title: { type: 'string' }, doneMark: { type: 'string' }, estimateMin: { type: 'integer' } },
      },
    },
  },
};

// Gemini に出させる形（src/gemini/schema.js が扱える部分集合）。
// 個数・範囲・文字数の検査は schema では足りないので candidates.js でも行う。
export function roadmapResponseSchema() {
  const axisProps = Object.fromEntries(AXES.map((a) => [a.key, { type: 'integer' }]));
  return {
    type: 'object',
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          required: ['label', 'summary', 'checkpoints', 'axes'],
          properties: {
            label: { type: 'string' },
            summary: { type: 'string' },
            checkpoints: {
              type: 'array',
              items: {
                type: 'object',
                required: ['title', 'doneMark', 'estimateMin'],
                properties: {
                  title: { type: 'string' },
                  doneMark: { type: 'string' },
                  estimateMin: { type: 'integer' },
                },
              },
            },
            axes: { type: 'object', required: AXES.map((a) => a.key), properties: axisProps },
          },
        },
      },
    },
  };
}
