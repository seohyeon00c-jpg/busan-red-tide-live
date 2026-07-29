import {
  calculateRisk,
  getRiskLevel,
  getTemperatureSuitability,
} from './risk.js';

export const FORECAST_MODEL_VERSION = '교육용 규칙모형 v0.1';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
});

const weekdayFormatter = new Intl.DateTimeFormat('ko-KR', {
  weekday: 'short',
});

function getForecastInputMode(area) {
  const fieldStatuses = Object.values(area.dataStatus?.fields ?? {});
  const observedFieldCount = fieldStatuses.filter(
    (status) => status === 'observed',
  ).length;

  if (fieldStatuses.length > 0 && observedFieldCount === fieldStatuses.length) {
    return {
      key: 'observed',
      label: '관측자료 기반 참고 예측',
      badge: '실험 예측',
    };
  }

  if (observedFieldCount > 0 || area.dataStatus?.measurements === 'hybrid') {
    return {
      key: 'hybrid',
      label: '관측·예시 혼합자료 기반 참고 예측',
      badge: '혼합자료 예측',
    };
  }

  return {
    key: 'demo',
    label: '예시 데이터 기반 시연 예측',
    badge: '시연 예측',
  };
}

function normalizeBaseDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  safeDate.setHours(12, 0, 0, 0);
  return safeDate;
}

function getDirection(firstScore, lastScore) {
  const difference = lastScore - firstScore;

  if (difference >= 5) {
    return {
      key: 'rising',
      label: '상승 전망',
      description: `${difference}점 상승`,
    };
  }

  if (difference <= -5) {
    return {
      key: 'falling',
      label: '하락 전망',
      description: `${Math.abs(difference)}점 하락`,
    };
  }

  return {
    key: 'steady',
    label: '비슷한 수준',
    description: `${Math.abs(difference)}점 이내 변화`,
  };
}

/**
 * 현재 환경이 유지된다는 가정과 최근 세포밀도 변화의 감쇠를 결합합니다.
 * 학습된 운영 예측모델이 아니며 연구·교육용 참고 시나리오만 제공합니다.
 */
export function createSevenDayForecast(area, options = {}) {
  const baseDate = normalizeBaseDate(options.baseDate ?? new Date());
  const inputMode = getForecastInputMode(area);
  const temperatureSuitability =
    getTemperatureSuitability(Number(area.waterTemperature) || 0) / 100;
  const initialGrowthSignal =
    clamp(Number(area.recentCellGrowth) || 0, -25, 45) / 100;
  const environmentPersistence = 0.45 + temperatureSuitability * 0.55;
  const initialCellDensity = Math.max(0, Number(area.cellDensity) || 0);
  let projectedCellDensity = initialCellDensity;

  const days = Array.from({ length: 7 }, (_, index) => {
    const dayOffset = index + 1;
    const trendAttenuation = Math.exp(-index * 0.22);
    const dailyGrowthRate =
      initialGrowthSignal *
      0.58 *
      trendAttenuation *
      environmentPersistence;

    projectedCellDensity = clamp(
      projectedCellDensity * (1 + dailyGrowthRate),
      0,
      100000,
    );

    const projectedMeasurements = {
      ...area,
      cellDensity: projectedCellDensity,
      recentCellGrowth: dailyGrowthRate * 100,
    };
    const calculatedRisk = calculateRisk(projectedMeasurements);
    const densityChangePoints =
      Math.log10(
        (projectedCellDensity + 1) / (initialCellDensity + 1),
      ) * 8;
    const score = Math.round(
      clamp(
        area.riskScore +
          (calculatedRisk.score - area.riskScore) * 0.55 +
          densityChangePoints,
        0,
        100,
      ),
    );
    const uncertainty = Math.round(
      3 + dayOffset * 1.8 + Math.abs(initialGrowthSignal) * dayOffset * 3,
    );
    const confidence = Math.round(
      clamp(
        86 -
          dayOffset * 5.5 -
          Math.abs(initialGrowthSignal) * dayOffset * 2,
        40,
        82,
      ),
    );
    const forecastDate = new Date(
      baseDate.getTime() + dayOffset * DAY_IN_MILLISECONDS,
    );

    return {
      day: dayOffset,
      date: forecastDate.toISOString().slice(0, 10),
      dateLabel: dateFormatter.format(forecastDate),
      weekday: weekdayFormatter.format(forecastDate),
      score,
      level: getRiskLevel(score),
      lowerScore: clamp(score - uncertainty, 0, 100),
      upperScore: clamp(score + uncertainty, 0, 100),
      confidence,
      projectedCellDensity: Math.round(projectedCellDensity),
      projectedDailyGrowth: Number((dailyGrowthRate * 100).toFixed(1)),
      dataStatus:
        inputMode.key === 'demo' ? 'demo-forecast' : 'experimental-forecast',
    };
  });

  const peak = days.reduce((highest, day) =>
    day.score > highest.score ? day : highest,
  );
  const direction = getDirection(days[0].score, days.at(-1).score);

  return {
    areaId: area.id,
    areaName: area.name,
    generatedAt: baseDate.toISOString(),
    referenceTime: area.referenceTime,
    modelVersion: FORECAST_MODEL_VERSION,
    inputMode,
    direction,
    peak,
    days,
    assumptions: [
      '현재 수온·염분·Chl-a·용존산소 환경이 유지된다고 가정',
      '최근 세포밀도 변화는 시간이 지날수록 약해지도록 감쇠',
      '기상·해류·강수의 미래 예보는 아직 반영하지 않음',
    ],
  };
}
