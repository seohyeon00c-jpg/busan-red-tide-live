/**
 * 연구·교육용 적조 위험지수 계산 모듈
 * 실제 예측모델이나 공식 적조특보 판정 로직이 아닙니다.
 */

export const RISK_WEIGHTS = Object.freeze({
  cellDensity: 0.45,
  temperature: 0.15,
  chlorophyllA: 0.12,
  salinity: 0.08,
  dissolvedOxygen: 0.05,
  growthTrend: 0.15,
});

export const ENVIRONMENT_FORECAST_WEIGHTS = Object.freeze({
  temperature: 0.4,
  chlorophyllA: 0.25,
  salinity: 0.2,
  dissolvedOxygen: 0.15,
});

export const DAILY_FORECAST_WEIGHTS = Object.freeze({
  cellDensity: 0.45,
  temperature: 0.25,
  chlorophyllA: 0.1,
  salinity: 0.05,
  dissolvedOxygen: 0.05,
  currentRetention: 0.05,
  calmSea: 0.05,
});

const clamp = (value, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * 코클로디니움 성장에 적합한 24~27℃ 구간에서 가장 높은 점수를 줍니다.
 */
export function getTemperatureSuitability(temperature) {
  if (temperature <= 18 || temperature >= 31) return 0;
  if (temperature >= 24 && temperature <= 27) return 100;
  if (temperature < 24) return clamp(((temperature - 18) / 6) * 100);
  return clamp(((31 - temperature) / 4) * 100);
}

function getCellDensityScore(cellDensity) {
  return clamp(
    (Math.log10(Math.max(0, cellDensity) + 1) / Math.log10(1001)) * 100,
  );
}

function getChlorophyllScore(chlorophyllA) {
  return clamp((chlorophyllA / 12) * 100);
}

function getSalinityScore(salinity) {
  if (salinity >= 28 && salinity <= 34) return 100;
  if (salinity < 28) return clamp(((salinity - 18) / 10) * 100);
  return clamp(((40 - salinity) / 6) * 100);
}

function getDissolvedOxygenRisk(dissolvedOxygen) {
  return clamp(((8 - dissolvedOxygen) / 5) * 100);
}

function getGrowthTrendScore(growthTrend) {
  return clamp((Math.max(0, growthTrend) / 80) * 100);
}

function getCurrentRetentionScore(currentVelocity) {
  if (!Number.isFinite(currentVelocity)) return 0;
  return clamp(((2.5 - currentVelocity) / 2.5) * 100);
}

function getCalmSeaScore(waveHeight) {
  if (!Number.isFinite(waveHeight)) return 0;
  return clamp(((1.5 - waveHeight) / 1.5) * 100);
}

export function getRiskLevel(score) {
  if (score >= 80) return '심각';
  if (score >= 60) return '경계';
  if (score >= 40) return '주의';
  if (score >= 20) return '관심';
  return '안전';
}

export function getRiskColor(score) {
  if (score >= 80) return '#7f1d1d';
  if (score >= 60) return '#dc2626';
  if (score >= 40) return '#f97316';
  if (score >= 20) return '#f59e0b';
  return '#14b8a6';
}

/**
 * 자체 위험지수와 요소별 기여도를 함께 반환합니다.
 */
export function calculateRisk(measurements) {
  const breakdown = {
    cellDensity: getCellDensityScore(measurements.cellDensity),
    temperature: getTemperatureSuitability(measurements.waterTemperature),
    chlorophyllA: getChlorophyllScore(measurements.chlorophyllA),
    salinity: getSalinityScore(measurements.salinity),
    dissolvedOxygen: getDissolvedOxygenRisk(
      measurements.dissolvedOxygen,
    ),
    growthTrend: getGrowthTrendScore(measurements.recentCellGrowth),
  };

  const score = Math.round(
    breakdown.cellDensity * RISK_WEIGHTS.cellDensity +
      breakdown.temperature * RISK_WEIGHTS.temperature +
      breakdown.chlorophyllA * RISK_WEIGHTS.chlorophyllA +
      breakdown.salinity * RISK_WEIGHTS.salinity +
      breakdown.dissolvedOxygen * RISK_WEIGHTS.dissolvedOxygen +
      breakdown.growthTrend * RISK_WEIGHTS.growthTrend,
  );

  return {
    score,
    level: getRiskLevel(score),
    breakdown,
  };
}

/**
 * 공식 환경 관측값만 조합한 0~100 파생지수입니다.
 * 세포밀도·증가추세를 포함하지 않으므로 적조 발생확률이나 공식 위험도가 아닙니다.
 */
export function calculateEnvironmentalRisk(measurements) {
  const factors = {
    temperature: {
      field: 'waterTemperature',
      score: getTemperatureSuitability(measurements.waterTemperature),
    },
    chlorophyllA: {
      field: 'chlorophyllA',
      score: getChlorophyllScore(measurements.chlorophyllA),
    },
    salinity: {
      field: 'salinity',
      score: getSalinityScore(measurements.salinity),
    },
    dissolvedOxygen: {
      field: 'dissolvedOxygen',
      score: getDissolvedOxygenRisk(measurements.dissolvedOxygen),
    },
  };

  const availableFactors = Object.entries(factors).filter(
    ([, factor]) =>
      measurements.dataStatus?.fields?.[factor.field] === 'observed' &&
      Number.isFinite(measurements[factor.field]),
  );
  const availableWeight = availableFactors.reduce(
    (total, [key]) => total + ENVIRONMENT_FORECAST_WEIGHTS[key],
    0,
  );

  if (availableFactors.length < 2 || availableWeight === 0) {
    return {
      available: false,
      score: null,
      level: '산정 불가',
      inputCount: availableFactors.length,
      completeness: Math.round(
        (availableFactors.length / Object.keys(factors).length) * 100,
      ),
      breakdown: Object.fromEntries(
        Object.entries(factors).map(([key, factor]) => [
          key,
          Number.isFinite(measurements[factor.field])
            ? factor.score
            : null,
        ]),
      ),
    };
  }

  const score = Math.round(
    availableFactors.reduce(
      (total, [key, factor]) =>
        total + factor.score * ENVIRONMENT_FORECAST_WEIGHTS[key],
      0,
    ) / availableWeight,
  );

  return {
    available: true,
    score,
    level: getRiskLevel(score),
    inputCount: availableFactors.length,
    completeness: Math.round(
      (availableFactors.length / Object.keys(factors).length) * 100,
    ),
    breakdown: Object.fromEntries(
      Object.entries(factors).map(([key, factor]) => [
        key,
        measurements.dataStatus?.fields?.[factor.field] === 'observed'
          ? Math.round(factor.score)
          : null,
      ]),
    ),
  };
}

/**
 * 날짜별 해양 수치예보와 현재 공식 관측자료를 결합한 모델 위험지수입니다.
 * 관측값이 없는 요소의 가중치는 다른 요소에 재분배하지 않습니다.
 * 따라서 세포밀도 없이 환경만 적합한 경우 심각 단계가 나오지 않습니다.
 */
export function calculateDailyForecastRisk(measurements, forecastDay) {
  const isObserved = (field) =>
    measurements.dataStatus?.fields?.[field] === 'observed' &&
    Number.isFinite(measurements[field]);

  const factors = {
    cellDensity: {
      available: isObserved('cellDensity'),
      score: isObserved('cellDensity')
        ? getCellDensityScore(measurements.cellDensity)
        : 0,
    },
    temperature: {
      available: Number.isFinite(forecastDay.seaSurfaceTemperature),
      score: Number.isFinite(forecastDay.seaSurfaceTemperature)
        ? getTemperatureSuitability(forecastDay.seaSurfaceTemperature)
        : 0,
    },
    chlorophyllA: {
      available: isObserved('chlorophyllA'),
      score: isObserved('chlorophyllA')
        ? getChlorophyllScore(measurements.chlorophyllA)
        : 0,
    },
    salinity: {
      available: isObserved('salinity'),
      score: isObserved('salinity')
        ? getSalinityScore(measurements.salinity)
        : 0,
    },
    dissolvedOxygen: {
      available: isObserved('dissolvedOxygen'),
      score: isObserved('dissolvedOxygen')
        ? getDissolvedOxygenRisk(measurements.dissolvedOxygen)
        : 0,
    },
    currentRetention: {
      available: Number.isFinite(forecastDay.oceanCurrentVelocity),
      score: getCurrentRetentionScore(forecastDay.oceanCurrentVelocity),
    },
    calmSea: {
      available: Number.isFinite(forecastDay.waveHeight),
      score: getCalmSeaScore(forecastDay.waveHeight),
    },
  };

  const score = Math.round(
    Object.entries(factors).reduce(
      (total, [key, factor]) =>
        total + factor.score * DAILY_FORECAST_WEIGHTS[key],
      0,
    ),
  );
  const availableWeight = Object.entries(factors).reduce(
    (total, [key, factor]) =>
      total + (factor.available ? DAILY_FORECAST_WEIGHTS[key] : 0),
    0,
  );

  return {
    available: factors.temperature.available,
    score,
    level: getRiskLevel(score),
    hasCellDensity: factors.cellDensity.available,
    inputCoverage: Math.round(availableWeight * 100),
    breakdown: Object.fromEntries(
      Object.entries(factors).map(([key, factor]) => [
        key,
        factor.available ? Math.round(factor.score) : null,
      ]),
    ),
  };
}

/**
 * 제공된 코클로디니움 세포밀도 공식 기준과 단순 비교합니다.
 * 반환값은 실제 공식 특보 발령 여부가 아닙니다.
 */
export function compareOfficialThreshold(cellDensity) {
  if (cellDensity >= 1000) return '경보 기준 이상';
  if (cellDensity >= 100) return '주의보 기준 이상';
  if (cellDensity >= 10) return '예비특보 기준 이상';
  return '예비특보 기준 미만';
}
