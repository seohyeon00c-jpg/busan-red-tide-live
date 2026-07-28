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
 * 제공된 코클로디니움 세포밀도 공식 기준과 단순 비교합니다.
 * 반환값은 실제 공식 특보 발령 여부가 아닙니다.
 */
export function compareOfficialThreshold(cellDensity) {
  if (cellDensity >= 1000) return '경보 기준 이상';
  if (cellDensity >= 100) return '주의보 기준 이상';
  if (cellDensity >= 10) return '예비특보 기준 이상';
  return '예비특보 기준 미만';
}
