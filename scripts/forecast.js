import { calculateDailyForecastRisk } from './risk.js?v=20260729-top-risk-v5';

export const FORECAST_MODEL_VERSION = '해양 수치예보 결합모형 v0.3';

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});

const weekdayFormatter = new Intl.DateTimeFormat('ko-KR', {
  weekday: 'short',
  timeZone: 'Asia/Seoul',
});

function toKoreaDate(dateString) {
  return new Date(`${dateString}T12:00:00+09:00`);
}

function getDirection(days) {
  const difference = days.at(-1).score - days[0].score;

  if (difference >= 5) {
    return {
      key: 'rising',
      icon: 'trending-up',
      label: '상승 전망',
      description: `${difference}점 상승`,
    };
  }

  if (difference <= -5) {
    return {
      key: 'falling',
      icon: 'trending-down',
      label: '하락 전망',
      description: `${Math.abs(difference)}점 하락`,
    };
  }

  return {
    key: 'steady',
    icon: 'move-right',
    label: '비슷한 수준',
    description: `${Math.abs(difference)}점 이내 변화`,
  };
}

/**
 * 시간별 해양 수치예보를 집계한 일별 값으로 오늘부터 8일을 계산합니다.
 * 관측 세포밀도가 없으면 해당 가중치를 0으로 유지해 과대평가를 막습니다.
 */
export function createSevenDayForecast(area, marineForecast) {
  const forecastDays = marineForecast?.days ?? [];

  if (forecastDays.length === 0) {
    return {
      available: false,
      areaId: area.id,
      areaName: area.name,
      modelVersion: FORECAST_MODEL_VERSION,
      days: [],
    };
  }

  const days = forecastDays.slice(0, 8).map((forecastDay, index) => {
    const risk = calculateDailyForecastRisk(area, forecastDay);
    const forecastDate = toKoreaDate(forecastDay.date);

    return {
      day: index,
      date: forecastDay.date,
      dateLabel: dateFormatter.format(forecastDate),
      weekday: weekdayFormatter.format(forecastDate),
      score: risk.score,
      level: risk.level,
      hasCellDensity: risk.hasCellDensity,
      inputCoverage: risk.inputCoverage,
      breakdown: risk.breakdown,
      seaSurfaceTemperature: forecastDay.seaSurfaceTemperature,
      oceanCurrentVelocity: forecastDay.oceanCurrentVelocity,
      waveHeight: forecastDay.waveHeight,
      dataStatus: 'marine-model-forecast',
    };
  });

  const peak = days.reduce((highest, day) =>
    day.score > highest.score ? day : highest,
  );

  return {
    available: true,
    areaId: area.id,
    areaName: area.name,
    generatedAt: marineForecast.fetchedAt,
    referenceTime: area.referenceTime,
    modelVersion: FORECAST_MODEL_VERSION,
    source: marineForecast.source,
    sourceUrl: marineForecast.sourceUrl,
    attribution: marineForecast.attribution,
    direction: getDirection(days),
    peak,
    days,
    hasCellDensity: days.some((day) => day.hasCellDensity),
    assumptions: [
      '날짜별 해수면수온·해류속도·파고 수치예보를 사용',
      'Chl-a·염분·용존산소는 현재 공식 관측값만 사용',
      '공식 세포밀도가 없으면 세포밀도 가중치를 0점으로 유지',
    ],
  };
}
