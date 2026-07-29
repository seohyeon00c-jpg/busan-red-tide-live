import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { marineAreas } from './data.js';
import { loadPublicMarineData } from './publicData.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  currentDirectory,
  '..',
  'data',
  'live-marine.json',
);

const nifsApiKey = process.env.NIFS_API_KEY?.trim();
const dataGoKrKey = process.env.DATA_GO_KR_KEY?.trim();

if (!nifsApiKey) {
  throw new Error('GitHub Secret NIFS_API_KEY가 설정되지 않았습니다.');
}

if (!dataGoKrKey) {
  throw new Error('GitHub Secret DATA_GO_KR_KEY가 설정되지 않았습니다.');
}

const collectedAt = new Date();
const state = await loadPublicMarineData(marineAreas, {
  now: collectedAt,
  skipCache: true,
  config: {
    NIFS_API_KEY: nifsApiKey,
    DATA_GO_KR_KEY: dataGoKrKey,
  },
});

const connectedPublicSources = state.sources.filter(
  (source) =>
    ['nifs', 'koem', 'busan'].includes(source.id) &&
    source.status === 'connected',
);

if (connectedPublicSources.length === 0) {
  throw new Error(
    'NIFS와 KOEM 공공데이터 연결에 모두 실패했습니다. Actions 로그의 상태 메시지를 확인하세요.',
  );
}

const payload = {
  schemaVersion: 1,
  generatedAt: collectedAt.toISOString(),
  collector: 'github-actions',
  mode: state.mode,
  areas: state.areas,
  sources: state.sources,
  warnings: state.warnings,
  officialObservations: state.officialObservations,
};
const serializedPayload = `${JSON.stringify(payload, null, 2)}\n`;

if (
  serializedPayload.includes(nifsApiKey) ||
  serializedPayload.includes(dataGoKrKey)
) {
  throw new Error('생성 파일에서 API 키 문자열이 감지되어 저장을 중단했습니다.');
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serializedPayload, 'utf8');

const sourceSummary = state.sources
  .filter((source) =>
    ['nifs', 'khoa', 'koem', 'busan'].includes(source.id),
  )
  .map((source) => `${source.id}:${source.status}`)
  .join(', ');

console.log(
  `공개 데이터 캐시 생성 완료 · 모드 ${state.mode} · ${sourceSummary}`,
);
