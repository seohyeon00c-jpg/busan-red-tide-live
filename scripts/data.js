import { calculateRisk } from './risk.js';

/**
 * 1단계 검토용 시연 스냅샷입니다.
 * 모든 수치는 실제 관측값이 아닌 예시 데이터입니다.
 */
export const DEMO_REFERENCE_TIME = '2026-07-28T14:00:00+09:00';

const areaSeeds = [
  {
    id: 'gijang',
    name: '기장',
    detail: '대변항 동방 연안',
    latitude: 35.2166,
    longitude: 129.246,
    cellDensity: 128,
    organism: '코클로디니움',
    waterTemperature: 25.8,
    chlorophyllA: 6.8,
    salinity: 32.1,
    dissolvedOxygen: 6.3,
    ph: 8.08,
    recentCellGrowth: 35,
  },
  {
    id: 'haeundae',
    name: '해운대',
    detail: '미포 남동방 연안',
    latitude: 35.1571,
    longitude: 129.1776,
    cellDensity: 74,
    organism: '코클로디니움',
    waterTemperature: 26.2,
    chlorophyllA: 5.7,
    salinity: 31.7,
    dissolvedOxygen: 6.7,
    ph: 8.11,
    recentCellGrowth: 28,
  },
  {
    id: 'gwangalli',
    name: '광안리',
    detail: '광안대교 외측',
    latitude: 35.1483,
    longitude: 129.1258,
    cellDensity: 42,
    organism: '코클로디니움',
    waterTemperature: 26.5,
    chlorophyllA: 4.9,
    salinity: 31.4,
    dissolvedOxygen: 6.9,
    ph: 8.12,
    recentCellGrowth: 16,
  },
  {
    id: 'yeongdo',
    name: '영도',
    detail: '태종대 남방 연안',
    latitude: 35.0527,
    longitude: 129.0874,
    cellDensity: 19,
    organism: '코클로디니움',
    waterTemperature: 25.3,
    chlorophyllA: 4.2,
    salinity: 32.4,
    dissolvedOxygen: 7.2,
    ph: 8.14,
    recentCellGrowth: 9,
  },
  {
    id: 'dadaepo',
    name: '다대포',
    detail: '다대포항 외측',
    latitude: 35.0358,
    longitude: 128.9631,
    cellDensity: 8,
    organism: '규조류 우점',
    waterTemperature: 24.9,
    chlorophyllA: 3.3,
    salinity: 30.8,
    dissolvedOxygen: 7.5,
    ph: 8.16,
    recentCellGrowth: 4,
  },
  {
    id: 'gadeokdo',
    name: '가덕도',
    detail: '대항항 남동방',
    latitude: 35.0026,
    longitude: 128.8315,
    cellDensity: 3,
    organism: '미동정 혼합종',
    waterTemperature: 24.4,
    chlorophyllA: 2.6,
    salinity: 31.2,
    dissolvedOxygen: 7.8,
    ph: 8.18,
    recentCellGrowth: -3,
  },
];

export const marineAreas = areaSeeds.map((area) => {
  const risk = calculateRisk(area);

  return {
    ...area,
    riskScore: risk.score,
    riskLevel: risk.level,
    riskBreakdown: risk.breakdown,
    referenceTime: DEMO_REFERENCE_TIME,
    dataStatus: {
      measurements: 'demo',
      riskIndex: 'derived-demo',
      officialAlert: 'not-connected',
      forecast: 'not-provided',
      fields: {
        cellDensity: 'demo',
        organism: 'demo',
        waterTemperature: 'demo',
        chlorophyllA: 'demo',
        salinity: 'demo',
        dissolvedOxygen: 'demo',
        ph: 'demo',
      },
    },
  };
});

/**
 * 선택 해역별 24시간 시연 추이 배열입니다.
 * 2026년 7월 27일 15시부터 28일 14시까지의 예시값을 생성합니다.
 */
export function createDemoHourlyTrend(area, areaIndex = 0) {
  const safeGrowthFactor = Math.max(0.2, 1 + area.recentCellGrowth / 100);
  const startDensity = area.cellDensity / safeGrowthFactor;

  return Array.from({ length: 24 }, (_, index) => {
    const progress = index / 23;
    const hour = (15 + index) % 24;
    const wave = Math.sin((index + areaIndex) * 0.72);
    const estimatedDensity =
      startDensity + (area.cellDensity - startDensity) * progress;

    return {
      time: `${String(hour).padStart(2, '0')}:00`,
      cellDensity:
        index === 23
          ? area.cellDensity
          : Math.round(
              Math.max(
                0,
                estimatedDensity + wave * Math.min(3.8, area.cellDensity * 0.06),
              ),
            ),
      waterTemperature:
        index === 23
          ? area.waterTemperature
          : Number(
              (
                area.waterTemperature -
                0.65 +
                progress * 0.65 +
                wave * 0.12
              ).toFixed(1),
            ),
      dataStatus: 'demo',
    };
  });
}

export const demoHourlyTrends = Object.fromEntries(
  marineAreas.map((area, index) => [
    area.id,
    createDemoHourlyTrend(area, index),
  ]),
);
