import {
  compareOfficialThreshold,
  getTemperatureSuitability,
} from './risk.js';

function getMonitoringAction(score) {
  if (score >= 80) {
    return '공식 발표를 즉시 확인하고 고밀도 지속 여부를 짧은 간격으로 관찰해야 합니다.';
  }
  if (score >= 60) {
    return '모니터링 주기를 단축하고 인접 해역의 공식 관측자료를 함께 확인할 필요가 있습니다.';
  }
  if (score >= 40) {
    return '세포밀도와 환경변수의 증가 여부를 지속적으로 관찰하는 것이 좋습니다.';
  }
  if (score >= 20) {
    return '현재 단계는 관심 수준이며 정기적인 자료 갱신과 추세 확인이 필요합니다.';
  }
  return '현재 단계는 안전 수준이지만 계절적 수온 변화는 계속 확인해야 합니다.';
}

/**
 * 선택 해역의 현재 시연값을 문장으로 변환합니다.
 * 생성형 AI를 사용하지 않는 규칙 기반 해설입니다.
 */
export function createDataBriefing(area) {
  const temperatureSuitability = getTemperatureSuitability(
    area.waterTemperature,
  );
  const officialComparison = compareOfficialThreshold(area.cellDensity);
  const growthDirection =
    area.recentCellGrowth > 0
      ? `최근 세포밀도는 ${area.recentCellGrowth}% 증가하는 시연 추세입니다.`
      : area.recentCellGrowth < 0
        ? `최근 세포밀도는 ${Math.abs(area.recentCellGrowth)}% 감소하는 시연 추세입니다.`
        : '최근 세포밀도는 변화가 없는 시연 추세입니다.';

  const temperatureSentence =
    temperatureSuitability >= 85
      ? `수온 ${area.waterTemperature.toFixed(1)}℃는 코클로디니움 성장 적합 구간인 24~27℃에 포함됩니다.`
      : `수온 ${area.waterTemperature.toFixed(1)}℃의 성장 적합도는 상대적으로 낮습니다.`;

  const environmentSentence =
    `Chl-a ${area.chlorophyllA.toFixed(1)}µg/L, 용존산소 ` +
    `${area.dissolvedOxygen.toFixed(1)}mg/L의 현재 구성값이 위험지수 계산에 반영됐습니다.`;

  return {
    summary:
      `${area.name} 해역의 자체 적조 위험지수는 ${area.riskScore}점으로 ` +
      `${area.riskLevel} 단계입니다. ${temperatureSentence} ${growthDirection} ` +
      `${environmentSentence}`,
    action: getMonitoringAction(area.riskScore),
    signals: [
      {
        label: '수온 적합성',
        value: temperatureSuitability >= 85 ? '높음' : '낮음',
        tone: temperatureSuitability >= 85 ? 'warning' : 'safe',
      },
      {
        label: '세포 증가 추세',
        value: `${area.recentCellGrowth > 0 ? '+' : ''}${area.recentCellGrowth}%`,
        tone: area.recentCellGrowth >= 20 ? 'warning' : 'neutral',
      },
      {
        label: '공식 기준 비교',
        value: officialComparison,
        tone: area.cellDensity >= 100 ? 'warning' : 'neutral',
      },
    ],
    disclaimer:
      '이 해설은 시연 또는 혼합 데이터를 정해진 규칙으로 설명한 문장이며 생성형 AI 분석이나 공식기관 판단이 아닙니다.',
  };
}
