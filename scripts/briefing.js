const formatters = {
  waterTemperature: (value) => `${value.toFixed(1)}℃`,
  chlorophyllA: (value) => `${value.toFixed(1)}µg/L`,
  salinity: (value) => `${value.toFixed(1)}PSU`,
  dissolvedOxygen: (value) => `${value.toFixed(1)}mg/L`,
  ph: (value) => value.toFixed(2),
  cellDensity: (value) => `${value.toLocaleString('ko-KR')}cells/mL`,
};

const labels = {
  waterTemperature: '수온',
  chlorophyllA: '엽록소-a',
  salinity: '염분',
  dissolvedOxygen: '용존산소',
  ph: 'pH',
  cellDensity: '적조생물 세포밀도',
};

function getObservedEntries(area) {
  return Object.keys(formatters)
    .filter(
      (field) =>
        area.dataStatus?.fields?.[field] === 'observed' &&
        Number.isFinite(area[field]),
    )
    .map((field) => ({
      field,
      label: labels[field],
      value: formatters[field](area[field]),
    }));
}

/**
 * 선택 해역에서 실제로 연결된 공식 관측값만 문장으로 변환합니다.
 */
export function createDataBriefing(area) {
  const observedEntries = getObservedEntries(area);
  const organismObserved =
    area.dataStatus?.fields?.organism === 'observed' && area.organism;
  const valuesText = observedEntries
    .map((entry) => `${entry.label} ${entry.value}`)
    .join(', ');

  if (observedEntries.length === 0 && !organismObserved) {
    return {
      summary: `${area.name} 해역에 현재 연결된 공식 관측값이 없습니다. 임의 수치나 예측값은 표시하지 않습니다.`,
      action:
        '국립수산과학원과 해양환경공단의 다음 자료 갱신을 기다려 주세요.',
      signals: [
        { label: '공식 관측항목', value: '0개', tone: 'neutral' },
        { label: '적조 세포밀도', value: '자료 없음', tone: 'neutral' },
        { label: '자체 위험지수', value: '산정 안 함', tone: 'neutral' },
      ],
      disclaimer:
        '공식 자료가 없는 항목은 예시값으로 대체하지 않습니다.',
    };
  }

  const organismText = organismObserved
    ? ` 원인생물은 ${area.organism}으로 기록됐습니다.`
    : '';
  const densityObserved =
    area.dataStatus?.fields?.cellDensity === 'observed';

  return {
    summary:
      `${area.name} 해역의 공식 관측자료에서 ${valuesText}가 확인됩니다.` +
      `${organismText} ` +
      (densityObserved
        ? '공식 세포밀도 자료가 연결되어 기준 비교가 가능합니다.'
        : '적조 발생 여부 판단에는 공식 세포밀도와 원인생물 자료가 추가로 필요합니다.'),
    action:
      '표시된 값은 공공기관 응답을 그대로 요약한 것으로, 실제 대응 전에는 해당 기관의 최신 발표를 확인하세요.',
    signals: [
      {
        label: '공식 관측항목',
        value: `${observedEntries.length + (organismObserved ? 1 : 0)}개`,
        tone: 'safe',
      },
      {
        label: '적조 세포밀도',
        value: densityObserved ? formatters.cellDensity(area.cellDensity) : '자료 없음',
        tone: densityObserved ? 'neutral' : 'neutral',
      },
      {
        label: '자체 위험지수',
        value: '산정 안 함',
        tone: 'neutral',
      },
    ],
    disclaimer:
      '규칙 기반 요약이며, 예시 데이터·임의 보간값·생성형 AI 판단을 사용하지 않습니다.',
  };
}
