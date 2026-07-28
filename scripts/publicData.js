import { calculateRisk } from './risk.js';

const NIFS_BASE_URL = 'https://www.nifs.go.kr/OpenAPI_json';
const KHOA_BASE_URL = 'https://apis.data.go.kr/1192136';
const KOEM_URL =
  'https://apis.data.go.kr/B553931/service/OceansNemoService2/getOceansNemo2';
const REQUEST_TIMEOUT = 8000;

const AREA_ALIASES = {
  gijang: ['기장', '대변'],
  haeundae: ['해운대', '미포'],
  gwangalli: ['광안', '수영만'],
  yeongdo: ['영도', '태종대'],
  dadaepo: ['다대포', '다대'],
  gadeokdo: ['가덕도', '가덕', '대항'],
};

const getConfig = () =>
  typeof window === 'undefined' ? {} : (window.APP_CONFIG ?? {});

const formatDate = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');

async function fetchJson(url, fetchImplementation = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetchImplementation(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function findRecordArray(value) {
  if (Array.isArray(value)) {
    const objectRecords = value.filter(
      (item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    );
    if (objectRecords.length > 0) return objectRecords;

    for (const item of value) {
      const nestedRecords = findRecordArray(item);
      if (nestedRecords.length > 0) return nestedRecords;
    }
  }

  if (value !== null && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      const nestedRecords = findRecordArray(nestedValue);
      if (nestedRecords.length > 0) return nestedRecords;
    }
  }

  return [];
}

function pick(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function asText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function asNumber(value) {
  const match = asText(value).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : undefined;
}

function asMaximumNumber(value) {
  const matches =
    asText(value).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/g) ?? [];
  const numbers = matches.map(Number).filter(Number.isFinite);
  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

function toDateKey(value) {
  const digits = asText(value).replace(/\D/g, '');
  if (digits.length < 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function matchArea(location, areas) {
  const normalized = asText(location).replaceAll(' ', '');
  if (!normalized) return undefined;

  return areas.find((area) =>
    (AREA_ALIASES[area.id] ?? [area.name]).some((alias) =>
      normalized.includes(alias.replaceAll(' ', '')),
    ),
  );
}

function cloneAreas(areas) {
  return areas.map((area) => ({
    ...area,
    riskBreakdown: { ...area.riskBreakdown },
    dataStatus: {
      ...area.dataStatus,
      fields: { ...area.dataStatus.fields },
    },
  }));
}

function markObserved(area, field) {
  area.dataStatus.fields[field] = 'observed';
  area.dataStatus.measurements = 'hybrid';
  area.dataStatus.riskIndex = 'derived-hybrid';
}

function updateNumberField(area, field, value) {
  if (value === undefined) return false;
  area[field] = value;
  markObserved(area, field);
  return true;
}

function recalculateRisks(areas) {
  areas.forEach((area) => {
    const risk = calculateRisk(area);
    area.riskScore = risk.score;
    area.riskLevel = risk.level;
    area.riskBreakdown = risk.breakdown;
  });
}

export async function fetchNifsRedTide(
  startDate,
  endDate,
  options = {},
) {
  const key = options.key ?? getConfig().NIFS_API_KEY?.trim();
  if (!key) throw new Error('NIFS API 키가 설정되지 않았습니다.');

  const url = new URL(NIFS_BASE_URL);
  url.searchParams.set('id', 'redtideList');
  url.searchParams.set('key', key);
  url.searchParams.set('sdate', formatDate(startDate));
  url.searchParams.set('edate', formatDate(endDate));

  return findRecordArray(
    await fetchJson(url, options.fetchImplementation),
  );
}

export async function fetchNifsRisa(startDate, endDate, options = {}) {
  const key = options.key ?? getConfig().NIFS_API_KEY?.trim();
  if (!key) throw new Error('NIFS API 키가 설정되지 않았습니다.');

  const url = new URL(NIFS_BASE_URL);
  url.searchParams.set('id', 'risaList');
  url.searchParams.set('key', key);
  url.searchParams.set('sdate', formatDate(startDate));
  url.searchParams.set('edate', formatDate(endDate));

  return findRecordArray(
    await fetchJson(url, options.fetchImplementation),
  );
}

export async function fetchKhoaRecent(
  type,
  observationCode,
  options = {},
) {
  const key = options.key ?? getConfig().DATA_GO_KR_KEY?.trim();
  if (!key) throw new Error('공공데이터포털 API 키가 설정되지 않았습니다.');
  if (!observationCode) throw new Error('KHOA 관측소 코드가 없습니다.');

  const path =
    type === 'tide'
      ? '/dtRecent/GetDTRecentApiService'
      : '/twRecent/GetTWRecentApiService';
  const url = new URL(`${KHOA_BASE_URL}${path}`);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('ObsCode', observationCode);
  url.searchParams.set('_type', 'json');

  return findRecordArray(
    await fetchJson(url, options.fetchImplementation),
  );
}

export async function fetchKoemMeasurements(year, options = {}) {
  const key = options.key ?? getConfig().DATA_GO_KR_KEY?.trim();
  if (!key) throw new Error('공공데이터포털 API 키가 설정되지 않았습니다.');

  const url = new URL(KOEM_URL);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('resultType', 'json');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', '200');
  url.searchParams.set('syr', String(year));

  return findRecordArray(
    await fetchJson(url, options.fetchImplementation),
  );
}

function mergeNifsRedTide(records, areas) {
  const officialObservations = [];
  let matchedFields = 0;

  records.forEach((record) => {
    const location = pick(record, [
      '조사해역',
      '조사지역',
      '조사장소',
      '해역명',
      'area',
      'areaNm',
      'location',
    ]);
    const area = matchArea(location, areas);
    if (!area) return;

    const density = asMaximumNumber(
      pick(record, [
        '최대생물밀도',
        '최대밀도',
        '생물밀도',
        'maxDensity',
        'maxCellDensity',
      ]),
    );
    const temperature = asMaximumNumber(
      pick(record, ['최대수온', '수온', 'maxTemp', 'waterTemp']),
    );
    const organism = asText(
      pick(record, ['원인생물', '생물명', 'organism', 'species']),
    );
    const observedAt = asText(
      pick(record, ['조사일시', '조사일자', '관측일시', 'date', 'obsDate']),
    );

    if (updateNumberField(area, 'cellDensity', density)) matchedFields += 1;
    if (updateNumberField(area, 'waterTemperature', temperature)) {
      matchedFields += 1;
    }
    if (organism) {
      area.organism = organism;
      markObserved(area, 'organism');
      matchedFields += 1;
    }
    if (observedAt) area.referenceTime = observedAt;

    const date = toDateKey(observedAt);
    if (date && (density !== undefined || organism)) {
      officialObservations.push({
        date,
        area: area.name,
        confirmed: true,
        maxCellDensity: density,
        source: '국립수산과학원 redtideList',
      });
    }
  });

  return { officialObservations, matchedFields };
}

function mergeNifsRisa(records, areas) {
  let matchedFields = 0;

  records.forEach((record) => {
    const station = pick(record, [
      '관측소',
      '관측소명',
      '정점명',
      'station',
      'stationName',
    ]);
    const area = matchArea(station, areas);
    if (!area) return;

    const temperature = asNumber(
      pick(record, ['수온', '수온(℃)', 'waterTemp', 'wtrTmp', 'temp']),
    );
    const observedAt = asText(
      pick(record, ['관측일시', '관측시간', 'date', 'obsDate']),
    );

    if (updateNumberField(area, 'waterTemperature', temperature)) {
      matchedFields += 1;
    }
    if (observedAt) area.referenceTime = observedAt;
  });

  return matchedFields;
}

function mergeKoem(records, areas) {
  let matchedFields = 0;

  records.forEach((record) => {
    const station = pick(record, [
      '정점명',
      '정점',
      '해역명',
      'station',
      'stationName',
      'staNm',
    ]);
    const area = matchArea(station, areas);
    if (!area) return;

    const fields = {
      chlorophyllA: asNumber(
        pick(record, ['Chl-a', 'CHL_A', 'chla', '클로로필a', '엽록소a']),
      ),
      ph: asNumber(pick(record, ['pH', 'PH', 'ph'])),
      dissolvedOxygen: asNumber(
        pick(record, ['DO', 'do', '용존산소']),
      ),
      waterTemperature: asNumber(
        pick(record, ['수온', 'waterTemp', 'wtrTmp']),
      ),
      salinity: asNumber(pick(record, ['염분', 'salinity', 'salt'])),
    };

    Object.entries(fields).forEach(([field, value]) => {
      if (updateNumberField(area, field, value)) matchedFields += 1;
    });
  });

  return matchedFields;
}

function mergeKhoa(records, areas, areaId) {
  const area = areas.find((item) => item.id === areaId);
  if (!area || records.length === 0) return 0;

  const latest = records.at(-1);
  let matchedFields = 0;
  const temperature = asNumber(
    pick(latest, ['수온', 'water_temp', 'waterTemp', 'wtrTmp']),
  );
  const salinity = asNumber(
    pick(latest, ['염분', 'salinity', 'salt']),
  );
  const observedAt = asText(
    pick(latest, ['관측시간', '관측일시', 'record_time', 'date']),
  );

  if (updateNumberField(area, 'waterTemperature', temperature)) {
    matchedFields += 1;
  }
  if (updateNumberField(area, 'salinity', salinity)) matchedFields += 1;
  if (observedAt) area.referenceTime = observedAt;

  return matchedFields;
}

function describeError(error) {
  if (error?.name === 'AbortError') return '요청 시간 초과';
  if (error instanceof TypeError) return '브라우저 CORS 또는 네트워크 오류';
  return error instanceof Error ? error.message : '알 수 없는 오류';
}

function createDefaultSources(config) {
  return [
    {
      id: 'nifs',
      agency: '국립수산과학원',
      dataset: '적조정보 · 실시간 해양수산환경',
      status: 'unavailable',
      message: config.NIFS_API_KEY
        ? '연결 확인 중'
        : '무료 API 키 미설정 · 시연 데이터 사용',
    },
    {
      id: 'khoa',
      agency: '국립해양조사원',
      dataset: '조위관측소 · 해양관측부이 최신자료',
      status: 'ready',
      message: config.DATA_GO_KR_KEY
        ? '관측소 코드 확인 중'
        : '무료 API 키·관측소 코드 설정 필요',
    },
    {
      id: 'koem',
      agency: '해양환경공단',
      dataset: '해양환경측정망',
      status: 'ready',
      message: config.DATA_GO_KR_KEY
        ? '연결 확인 중'
        : '무료 공공데이터포털 키 설정 필요',
    },
    {
      id: 'map',
      agency: '사용자 제공 이미지',
      dataset: '부산 행정구역 PNG 지도',
      status: 'connected',
      message: '로컬 이미지 · 외부 지도 타일 호출 없음',
    },
  ];
}

/**
 * 가능한 공공데이터를 병렬 호출하고 실패한 자료는 시연 데이터로 유지합니다.
 */
export async function loadPublicMarineData(demoAreas, options = {}) {
  const config = { ...getConfig(), ...(options.config ?? {}) };
  const fetchImplementation = options.fetchImplementation;
  const now = options.now ?? new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 30);
  const areas = cloneAreas(demoAreas);
  const sources = createDefaultSources(config);
  const warnings = [];
  const operations = [];

  if (config.NIFS_API_KEY?.trim()) {
    operations.push(
      {
        id: 'nifs-redtide',
        request: fetchNifsRedTide(startDate, now, {
          key: config.NIFS_API_KEY.trim(),
          fetchImplementation,
        }),
      },
      {
        id: 'nifs-risa',
        request: fetchNifsRisa(startDate, now, {
          key: config.NIFS_API_KEY.trim(),
          fetchImplementation,
        }),
      },
    );
  }

  if (config.DATA_GO_KR_KEY?.trim()) {
    operations.push({
      id: 'koem',
      request: fetchKoemMeasurements(now.getFullYear(), {
        key: config.DATA_GO_KR_KEY.trim(),
        fetchImplementation,
      }),
    });

    if (config.KHOA_TIDE_OBSERVATION_CODE?.trim()) {
      operations.push({
        id: 'khoa-tide',
        request: fetchKhoaRecent(
          'tide',
          config.KHOA_TIDE_OBSERVATION_CODE.trim(),
          {
            key: config.DATA_GO_KR_KEY.trim(),
            fetchImplementation,
          },
        ),
      });
    }

    if (config.KHOA_BUOY_OBSERVATION_CODE?.trim()) {
      operations.push({
        id: 'khoa-buoy',
        request: fetchKhoaRecent(
          'buoy',
          config.KHOA_BUOY_OBSERVATION_CODE.trim(),
          {
            key: config.DATA_GO_KR_KEY.trim(),
            fetchImplementation,
          },
        ),
      });
    }
  }

  const results = await Promise.all(
    operations.map(async ({ id, request }) => {
      try {
        return { id, ok: true, records: await request };
      } catch (error) {
        return { id, ok: false, error };
      }
    }),
  );
  const resultById = new Map(results.map((result) => [result.id, result]));
  const officialObservations = [];
  let observedFieldCount = 0;

  const nifsRedTide = resultById.get('nifs-redtide');
  const nifsRisa = resultById.get('nifs-risa');
  const nifsSource = sources.find((source) => source.id === 'nifs');

  if (nifsRedTide?.ok) {
    const merged = mergeNifsRedTide(nifsRedTide.records, areas);
    observedFieldCount += merged.matchedFields;
    officialObservations.push(...merged.officialObservations);
  }
  if (nifsRisa?.ok) {
    observedFieldCount += mergeNifsRisa(nifsRisa.records, areas);
  }

  if (nifsRedTide?.ok || nifsRisa?.ok) {
    nifsSource.status = 'connected';
    nifsSource.message =
      observedFieldCount > 0
        ? 'API 연결 · 부산 매칭 관측값 반영'
        : 'API 연결 · 기간 내 부산 매칭 자료 없음';
  } else if (config.NIFS_API_KEY?.trim()) {
    const errors = [nifsRedTide, nifsRisa]
      .filter((result) => result && !result.ok)
      .map((result) => describeError(result.error));
    nifsSource.status = 'unavailable';
    nifsSource.message = '연결 실패 · 시연 데이터로 안전 전환';
    warnings.push(`NIFS 연결 실패: ${[...new Set(errors)].join(', ')}`);
  }

  const koemResult = resultById.get('koem');
  const koemSource = sources.find((source) => source.id === 'koem');
  if (koemResult?.ok) {
    const matched = mergeKoem(koemResult.records, areas);
    observedFieldCount += matched;
    koemSource.status = 'connected';
    koemSource.message =
      matched > 0
        ? 'API 연결 · 부산 매칭 환경값 반영'
        : 'API 연결 · 부산 해역 정점 매칭 필요';
  } else if (koemResult && !koemResult.ok) {
    koemSource.status = 'unavailable';
    koemSource.message = '연결 실패 · 관련 지표는 예시값 유지';
    warnings.push(`KOEM 연결 실패: ${describeError(koemResult.error)}`);
  }

  const khoaSource = sources.find((source) => source.id === 'khoa');
  const khoaResults = [
    resultById.get('khoa-tide'),
    resultById.get('khoa-buoy'),
  ].filter(Boolean);
  let khoaMatchedFields = 0;

  const tideResult = resultById.get('khoa-tide');
  if (tideResult?.ok) {
    khoaMatchedFields += mergeKhoa(
      tideResult.records,
      areas,
      config.KHOA_TIDE_AREA_ID,
    );
  }
  const buoyResult = resultById.get('khoa-buoy');
  if (buoyResult?.ok) {
    khoaMatchedFields += mergeKhoa(
      buoyResult.records,
      areas,
      config.KHOA_BUOY_AREA_ID,
    );
  }
  observedFieldCount += khoaMatchedFields;

  if (khoaResults.some((result) => result.ok)) {
    khoaSource.status = 'connected';
    khoaSource.message =
      khoaMatchedFields > 0
        ? 'API 연결 · 지정 해역 최신값 반영'
        : 'API 연결 · 해역 ID 매핑 필요';
  } else if (khoaResults.some((result) => !result.ok)) {
    khoaSource.status = 'unavailable';
    khoaSource.message = '연결 실패 · 관련 지표는 예시값 유지';
    warnings.push(
      `KHOA 연결 실패: ${[
        ...new Set(
          khoaResults
            .filter((result) => !result.ok)
            .map((result) => describeError(result.error)),
        ),
      ].join(', ')}`,
    );
  }

  recalculateRisks(areas);

  const uniqueOfficialObservations = [
    ...new Map(
      officialObservations.map((item) => [
        `${item.date}-${item.area}`,
        item,
      ]),
    ).values(),
  ];
  const mode = observedFieldCount > 0 ? 'hybrid' : 'demo';

  if (mode === 'demo') {
    warnings.unshift(
      '공공 관측값이 반영되지 않아 모든 해양 수치는 예시 데이터입니다.',
    );
  } else {
    warnings.unshift(
      '일부 공식 관측값만 반영됐으며 나머지 환경지표와 24시간 추이는 예시 데이터입니다.',
    );
  }

  return {
    areas,
    mode,
    sources,
    warnings,
    officialObservations: uniqueOfficialObservations,
    updatedAt: now.toISOString(),
  };
}
