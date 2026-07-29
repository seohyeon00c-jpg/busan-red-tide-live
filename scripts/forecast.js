import {
  calculateEnvironmentalRisk,
  getRiskLevel,
} from './risk.js?v=20260729-weekly';

export const FORECAST_MODEL_VERSION = '주간 예측 규칙모형 v0.2';

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

function getForecastInputMode(area, environmentalRisk) {
  const historicalInput = /2024년 연평균/.test(area.referenceTime ?? '');
  const unknownObservationTime =
    /미제공|정보 없음/.test(area.referenceTime ?? '');

  return {
    key: historicalInput ? 'historical-derived' : 'official-derived',
    label: '수온·Chl-a·염분·용존산소 조합 모델',
    badge: '모델 예측',
    historicalInput,
    unknownObservationTime,
    inputCount: environmentalRisk.inputCount,
    completeness: environmentalRisk.completeness,
  };
}

function normalizeBaseDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  safeDate.setHours(12, 0, 0, 0);
  return safeDate;
}

function getDirection() {
  return {
    key: 'steady',
    label: '비슷한 수준',
    description: '변화 없음',
  };
}

/**
 * 현재 공식 환경값이 유지된다는 조건으로 오늘부터 다음 주 같은 요일까지 전망합니다.
 * 미래 관측값·기상예보·세포밀도를 생성하지 않는 연구·교육용 시나리오입니다.
 */
export function createSevenDayForecast(area, options = {}) {
  const baseDate = normalizeBaseDate(options.baseDate ?? new Date());
  const environmentalRisk = calculateEnvironmentalRisk(area);
  const inputMode = getForecastInputMode(area, environmentalRisk);

  if (!environmentalRisk.available) {
    return {
      available: false,
      areaId: area.id,
      areaName: area.name,
      generatedAt: baseDate.toISOString(),
      referenceTime: area.referenceTime,
      modelVersion: FORECAST_MODEL_VERSION,
      inputMode,
      days: [],
      assumptions: [
        '수온·Chl-a·염분·용존산소 중 공식값이 2개 이상 필요',
        '자료가 부족한 경우 임의 수치로 보완하지 않음',
      ],
    };
  }

  const confidenceBase = inputMode.historicalInput
    ? 38
    : inputMode.unknownObservationTime
      ? 44
      : 52;

  const days = Array.from({ length: 8 }, (_, index) => {
    const dayOffset = index;
    const forecastStep = index + 1;
    const score = environmentalRisk.score;
    const uncertainty =
      10 +
      forecastStep * 3 +
      (4 - environmentalRisk.inputCount) * 3 +
      (inputMode.historicalInput ? 7 : 0);
    const confidence = Math.round(
      clamp(confidenceBase - forecastStep * 3, 15, confidenceBase),
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
      dataStatus: 'official-derived-forecast',
    };
  });

  const peak = days.reduce((highest, day) =>
    day.score > highest.score ? day : highest,
  );
  const direction = getDirection();

  return {
    available: true,
    areaId: area.id,
    areaName: area.name,
    generatedAt: baseDate.toISOString(),
    referenceTime: area.referenceTime,
    modelVersion: FORECAST_MODEL_VERSION,
    inputMode,
    environmentalRisk,
    direction,
    peak,
    days,
    assumptions: [
      '현재 공식 수온·Chl-a·염분·용존산소 환경이 전망기간 동안 유지된다고 가정',
      '세포밀도·최근 증가추세가 없어 적조 발생확률이 아닌 환경 위험도만 계산',
      '기상·해류·강수의 미래 예보는 반영하지 않으며 기간이 길수록 불확실성 확대',
    ],
  };
}
