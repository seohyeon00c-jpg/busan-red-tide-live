/**
 * 부산 6개 해역의 위치·표시용 메타데이터입니다.
 * 관측 수치는 공공데이터 응답으로만 채우며 임의의 예시값을 두지 않습니다.
 */
const areaSeeds = [
  {
    id: 'gijang',
    name: '기장',
    detail: '대변항 동방 연안',
    latitude: 35.2166,
    longitude: 129.246,
  },
  {
    id: 'haeundae',
    name: '해운대',
    detail: '미포 남동방 연안',
    latitude: 35.1571,
    longitude: 129.1776,
  },
  {
    id: 'gwangalli',
    name: '광안리',
    detail: '광안대교 외측',
    latitude: 35.1483,
    longitude: 129.1258,
  },
  {
    id: 'yeongdo',
    name: '영도',
    detail: '태종대 남방 연안',
    latitude: 35.0527,
    longitude: 129.0874,
  },
  {
    id: 'dadaepo',
    name: '다대포',
    detail: '다대포항 외측',
    latitude: 35.0358,
    longitude: 128.9631,
  },
  {
    id: 'gadeokdo',
    name: '가덕도',
    detail: '대항항 남동방',
    latitude: 35.0026,
    longitude: 128.8315,
  },
];

const measurementFields = [
  'cellDensity',
  'organism',
  'waterTemperature',
  'chlorophyllA',
  'salinity',
  'dissolvedOxygen',
  'ph',
];

export const marineAreas = areaSeeds.map((area) => ({
  ...area,
  cellDensity: null,
  organism: null,
  waterTemperature: null,
  chlorophyllA: null,
  salinity: null,
  dissolvedOxygen: null,
  ph: null,
  recentCellGrowth: null,
  riskScore: null,
  riskLevel: '산정 불가',
  riskBreakdown: null,
  referenceTime: '공식 관측자료 없음',
  dataStatus: {
    measurements: 'unavailable',
    riskIndex: 'unavailable',
    officialAlert: 'not-connected',
    forecast: 'unavailable',
    fields: Object.fromEntries(
      measurementFields.map((field) => [field, 'unavailable']),
    ),
  },
}));
