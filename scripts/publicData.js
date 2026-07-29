const NIFS_BASE_URL = 'https://www.nifs.go.kr/OpenAPI_json';
const KOEM_URL =
  'https://apis.data.go.kr/B553931/service/OceansNemoService2/getOceansNemo2';
const REQUEST_TIMEOUT = 8000;
const KOEM_REQUEST_TIMEOUT = 30000;
const PUBLIC_CACHE_URL = './data/live-marine.json';
const PUBLIC_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const MEASUREMENT_FIELDS = [
  'cellDensity',
  'organism',
  'waterTemperature',
  'chlorophyllA',
  'salinity',
  'dissolvedOxygen',
  'ph',
];

const AREA_ALIASES = {
  gijang: ['기장', '대변', '일광', '고리'],
  haeundae: ['해운대', '해운대해수욕장', '미포', '송정'],
  gwangalli: ['광안', '광안리', '민락', '수영만', '수영', '이기대'],
  yeongdo: ['영도', '태종대', '부산항', '남항', '북내항', '5부두'],
  dadaepo: ['다대포', '다대포항', '다대포어시장', '다대', '장림', '낙동강하구'],
  gadeokdo: ['가덕도', '가덕', '가덕대교', '대항', '신항', '신외항', '녹산', '신호', '진해만'],
};

const KOEM_BUSAN_STATIONS = [
  '고리',
  '대변',
  '해운대해수욕장',
  '광안리',
  '민락동',
  '남항',
  '북내항',
  '5부두',
  '다대포항',
  '다대포어시장',
  '장림',
  '신항',
  '신외항',
  '녹산',
  '신호',
  '가덕대교',
];

const getConfig = () =>
  typeof window === 'undefined' ? {} : (window.APP_CONFIG ?? {});

const formatDate = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');

/**
 * 공공데이터포털에서 제공하는 인코딩 키와 디코딩 키를 모두 한 번만 인코딩합니다.
 */
function normalizeDataGoKrKey(key) {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function decodeXmlText(value) {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

function parseXmlRecords(text) {
  const resultCode =
    text.match(/<resultCode[^>]*>([\s\S]*?)<\/resultCode>/i)?.[1] ?? '';
  const resultMessage =
    text.match(/<resultMsg[^>]*>([\s\S]*?)<\/resultMsg>/i)?.[1] ?? '';

  if (resultCode && !['0', '00'].includes(decodeXmlText(resultCode))) {
    throw new Error(
      `API 응답 오류: ${decodeXmlText(resultMessage) || decodeXmlText(resultCode)}`,
    );
  }

  const itemBlocks = [
    ...text.matchAll(/<(?:item|Item)[^>]*>([\s\S]*?)<\/(?:item|Item)>/g),
  ];

  if (
    itemBlocks.length === 0 &&
    /SERVICE_KEY|INVALID REQUEST|APPLICATION_ERROR|DEADLINE_EXCEEDED/i.test(
      text,
    )
  ) {
    throw new Error('API 인증 또는 요청 형식 오류');
  }

  return itemBlocks.map((match) => {
    const record = {};
    const fieldPattern =
      /<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;

    for (const field of match[1].matchAll(fieldPattern)) {
      record[field[1]] = decodeXmlText(field[2]);
    }

    return record;
  });
}

function findNestedValue(value, targetKeys) {
  if (!value || typeof value !== 'object') return undefined;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (targetKeys.includes(key)) return nestedValue;
  }

  for (const nestedValue of Object.values(value)) {
    const found = findNestedValue(nestedValue, targetKeys);
    if (found !== undefined) return found;
  }

  return undefined;
}

function assertJsonSuccess(payload) {
  const resultCode = asText(
    findNestedValue(payload, ['resultCode', 'result_code']),
  );
  if (!resultCode || ['0', '00'].includes(resultCode)) return;

  const resultMessage = asText(
    findNestedValue(payload, ['resultMsg', 'resultMessage', 'result_msg']),
  );
  throw new Error(`API 응답 오류: ${resultMessage || resultCode}`);
}

async function fetchJson(
  url,
  fetchImplementation = fetch,
  requestTimeout = REQUEST_TIMEOUT,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeout);

  try {
    const response = await fetchImplementation(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json, application/xml, text/xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) return [];

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      if (text.trim().startsWith('<')) return parseXmlRecords(text);
      throw new Error('API 응답을 해석할 수 없습니다.');
    }

    assertJsonSuccess(payload);
    return payload;
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
    riskBreakdown: area.riskBreakdown
      ? { ...area.riskBreakdown }
      : null,
    dataStatus: {
      ...area.dataStatus,
      fields: { ...area.dataStatus.fields },
    },
  }));
}

function markObserved(area, field) {
  area.dataStatus.fields[field] = 'observed';
  area.dataStatus.measurements = 'observed';
  area.dataStatus.riskIndex = 'unavailable';
}

function updateNumberField(area, field, value) {
  if (value === undefined) return false;
  area[field] = value;
  markObserved(area, field);
  return true;
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

export async function fetchNifsRisa(options = {}) {
  const key = options.key ?? getConfig().NIFS_API_KEY?.trim();
  if (!key) throw new Error('NIFS API 키가 설정되지 않았습니다.');

  const url = new URL(NIFS_BASE_URL);
  url.searchParams.set('id', 'risaList');
  url.searchParams.set('key', key);

  return findRecordArray(
    await fetchJson(url, options.fetchImplementation),
  );
}

export async function fetchKoemMeasurements(options = {}) {
  const key = options.key ?? getConfig().DATA_GO_KR_KEY?.trim();
  if (!key) throw new Error('공공데이터포털 API 키가 설정되지 않았습니다.');

  const endDate = options.endDate ?? new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (options.lookbackDays ?? 550));
  const stationNames = options.stationNames ?? KOEM_BUSAN_STATIONS;

  const results = await Promise.allSettled(
    stationNames.map(async (stationName) => {
      const url = new URL(KOEM_URL);
      url.searchParams.set('serviceKey', normalizeDataGoKrKey(key));
      url.searchParams.set('pageNo', '1');
      url.searchParams.set('numOfRows', '10');
      url.searchParams.set('resultType', 'xml');
      url.searchParams.set('_type', 'xml');
      url.searchParams.set('sdate', formatDate(startDate));
      url.searchParams.set('edate', formatDate(endDate));
      url.searchParams.set('OCEAN_NM', '남해');
      url.searchParams.set('STNPNT_KOREAN_NM', stationName);

      return findRecordArray(
        await fetchJson(
          url,
          options.fetchImplementation,
          options.timeout ?? KOEM_REQUEST_TIMEOUT,
        ),
      );
    }),
  );

  const successfulResults = results.filter(
    (result) => result.status === 'fulfilled',
  );
  if (successfulResults.length === 0) {
    throw results[0]?.reason ?? new Error('KOEM 부산 정점 요청에 실패했습니다.');
  }

  return successfulResults.flatMap((result) => result.value);
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
      'txt_seas',
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
        'max_density',
        'maxDensity',
        'maxCellDensity',
      ]),
    );
    const temperature = asMaximumNumber(
      pick(record, [
        '최대수온',
        '수온',
        'max_watertemp',
        'maxTemp',
        'waterTemp',
      ]),
    );
    const organism = asText(
      pick(record, [
        '원인생물',
        '생물명',
        'nam_biology',
        'organism',
        'species',
      ]),
    );
    const observedAt = asText(
      pick(record, [
        '조사일시',
        '조사일자',
        '관측일시',
        'day_report',
        'date',
        'obsDate',
      ]),
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
      'sta_nam_kor',
      'station',
      'stationName',
    ]);
    const area = matchArea(station, areas);
    if (!area) return;

    const temperature = asNumber(
      pick(record, [
        '수온',
        '수온(℃)',
        'wtr_tmp',
        'waterTemp',
        'wtrTmp',
        'temp',
      ]),
    );
    const observedDate = asText(
      pick(record, ['관측일자', 'obs_dat', 'date', 'obsDate']),
    );
    const observedTime = asText(
      pick(record, ['관측시간', 'obs_tim', 'time', 'obsTime']),
    );
    const observedAt = [observedDate, observedTime]
      .filter(Boolean)
      .join(' ');

    if (updateNumberField(area, 'waterTemperature', temperature)) {
      matchedFields += 1;
    }
    if (observedAt) area.referenceTime = observedAt;
  });

  return matchedFields;
}

function mergeKoem(records, areas) {
  let matchedFields = 0;
  const receivedStations = new Set();
  const matchedStations = new Set();
  const receivedFields = new Set();

  records.forEach((record) => {
    Object.keys(record).forEach((field) => receivedFields.add(field));

    const station = pick(record, [
      '정점명',
      '정점',
      '해역명',
      'STNPNT_KOREAN_NM',
      'stnpntKoreanNm',
      'stnpntNm',
      'oceanNm',
      'station',
      'stationName',
      'staNm',
    ]);
    const stationName = asText(station);
    if (stationName) receivedStations.add(stationName);

    const area = matchArea(station, areas);
    if (!area) return;
    matchedStations.add(stationName);

    const fields = {
      chlorophyllA: asNumber(
        pick(record, [
          'Chl-a',
          'CHL_A',
          'chla',
          'chlaSur',
          'chlASur',
          'chlaSfclyr',
          'chlASfclyr',
          'clrplSfclyr',
          'chlorophyllASfclyr',
          '클로로필a',
          '클로로필A표층',
          '엽록소a',
        ]),
      ),
      ph: asNumber(
        pick(record, [
          'pH',
          'PH',
          'ph',
          'phSur',
          'phDnstySfclyr',
          '수소이온농도표층',
        ]),
      ),
      dissolvedOxygen: asNumber(
        pick(record, [
          'DO',
          'do',
          'doxSur',
          'doSur',
          'doxySfclyr',
          '용존산소',
          '용존산소량표층',
        ]),
      ),
      waterTemperature: asNumber(
        pick(record, [
          '수온',
          '수온표층',
          'wtemSur',
          'waterTemp',
          'wtrTmp',
          'wtrtmpSfclyr',
        ]),
      ),
      salinity: asNumber(
        pick(record, [
          '염분',
          '염분표층',
          'salntySur',
          'salinity',
          'salt',
          'salntSfclyr',
        ]),
      ),
    };

    let recordMatchedFields = 0;
    Object.entries(fields).forEach(([field, value]) => {
      if (updateNumberField(area, field, value)) {
        matchedFields += 1;
        recordMatchedFields += 1;
      }
    });

    const observedAt = asText(
      pick(record, [
        '관측일자',
        'obsDate',
        'mesureDe',
        'investigationDate',
      ]),
    );
    if (observedAt) {
      area.referenceTime = observedAt;
    } else if (recordMatchedFields > 0) {
      area.referenceTime = 'KOEM 관측시각 미제공';
    }
  });

  return {
    matchedFields,
    matchedStations: [...matchedStations],
    receivedStations: [...receivedStations],
    receivedFields: [...receivedFields],
  };
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
        : '공개 데이터 캐시 없음 · 자료 없음으로 표시',
    },
    {
      id: 'khoa',
      agency: '국립해양조사원',
      dataset: '해양관측 국가중점데이터',
      status: 'ready',
      message: '기존 최신관측 API 폐기 · 대체서비스 검토 중',
    },
    {
      id: 'koem',
      agency: '해양환경공단',
      dataset: '해양환경측정망',
      status: 'ready',
      message: config.DATA_GO_KR_KEY
        ? '연결 확인 중'
        : '공개 데이터 캐시 없음 · 자료 없음으로 표시',
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

function mergeCachedArea(baseArea, cachedArea) {
  if (!cachedArea || cachedArea.id !== baseArea.id) {
    return cloneAreas([baseArea])[0];
  }

  const area = cloneAreas([baseArea])[0];
  let observedFieldCount = 0;

  MEASUREMENT_FIELDS.forEach((field) => {
    if (cachedArea.dataStatus?.fields?.[field] !== 'observed') return;

    const value = cachedArea[field];
    const valid =
      field === 'organism'
        ? typeof value === 'string' && value.trim().length > 0
        : Number.isFinite(value);
    if (!valid) return;

    area[field] = value;
    markObserved(area, field);
    observedFieldCount += 1;
  });

  if (observedFieldCount > 0) {
    area.referenceTime = cachedArea.referenceTime || '관측시각 미제공';
  }
  area.dataStatus.officialAlert =
    cachedArea.dataStatus?.officialAlert ?? area.dataStatus.officialAlert;

  return area;
}

async function loadPublicDataCache(baseAreas, options, config) {
  const now = options.now ?? new Date();
  const cacheUrl =
    options.cacheUrl ??
    config.PUBLIC_DATA_CACHE_URL?.trim() ??
    PUBLIC_CACHE_URL;
  const payload = await fetchJson(cacheUrl, options.fetchImplementation);

  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.schemaVersion !== 1 ||
    !Array.isArray(payload.areas)
  ) {
    throw new Error('공개 데이터 캐시 형식이 올바르지 않습니다.');
  }

  const generatedAt = new Date(payload.generatedAt ?? payload.updatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error('공개 데이터 캐시 생성 시각이 없습니다.');
  }

  const age = Math.max(0, now.getTime() - generatedAt.getTime());
  const maximumAge = options.cacheMaxAge ?? PUBLIC_CACHE_MAX_AGE;
  if (age > maximumAge) {
    throw new Error('공개 데이터 캐시가 24시간 이상 갱신되지 않았습니다.');
  }

  const cachedById = new Map(
    payload.areas.map((area) => [area.id, area]),
  );
  const areas = baseAreas.map((area) =>
    mergeCachedArea(area, cachedById.get(area.id)),
  );
  const observedFieldCount = areas.reduce(
    (total, area) =>
      total +
      Object.values(area.dataStatus.fields).filter(
        (status) => status === 'observed',
      ).length,
    0,
  );
  const ageInHours = Math.max(0, Math.floor(age / (60 * 60 * 1000)));
  const cacheWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter(
        (warning) => !/시연|예시|혼합/.test(String(warning)),
      )
    : [];
  const warnings = [
    `공식 관측값만 표시합니다. 마지막 수집: ${ageInHours}시간 전`,
    ...cacheWarnings,
  ];

  return {
    areas,
    mode: observedFieldCount > 0 ? 'official' : 'unavailable',
    sources: Array.isArray(payload.sources)
      ? payload.sources
      : createDefaultSources(config),
    warnings,
    officialObservations: Array.isArray(payload.officialObservations)
      ? payload.officialObservations
      : [],
    updatedAt: generatedAt.toISOString(),
    cache: {
      source: 'github-actions',
      generatedAt: generatedAt.toISOString(),
      age,
    },
  };
}

/**
 * 가능한 공공데이터를 병렬 호출하고 공식 응답이 없는 항목은 비워 둡니다.
 */
export async function loadPublicMarineData(baseAreas, options = {}) {
  const config = { ...getConfig(), ...(options.config ?? {}) };
  const fetchImplementation = options.fetchImplementation;
  const now = options.now ?? new Date();
  let cacheError;

  if (
    !options.skipCache &&
    (options.preferCache || typeof window !== 'undefined')
  ) {
    try {
      return await loadPublicDataCache(baseAreas, options, config);
    } catch (error) {
      cacheError = error;
    }
  }

  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 30);
  const areas = cloneAreas(baseAreas);
  const sources = createDefaultSources(config);
  const warnings = [];
  const operations = [];

  if (cacheError) {
    warnings.push(
      '공개 데이터 캐시를 읽지 못해 공식 관측값을 표시할 수 없습니다.',
    );
  }

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
        request: fetchNifsRisa({
          key: config.NIFS_API_KEY.trim(),
          fetchImplementation,
        }),
      },
    );
  }

  if (config.DATA_GO_KR_KEY?.trim()) {
    operations.push({
      id: 'koem',
      request: fetchKoemMeasurements({
        key: config.DATA_GO_KR_KEY.trim(),
        fetchImplementation,
        endDate: now,
      }),
    });

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
    nifsSource.message = '연결 실패 · 관련 항목은 자료 없음';
    warnings.push(`NIFS 연결 실패: ${[...new Set(errors)].join(', ')}`);
  }

  const koemResult = resultById.get('koem');
  const koemSource = sources.find((source) => source.id === 'koem');
  if (koemResult?.ok) {
    const merged = mergeKoem(koemResult.records, areas);
    const measurementFields = merged.receivedFields.filter((field) =>
      /temp|wtem|wtr|sal|ph|dox|oxy|chlor|chl|수온|염분|용존|클로로필/i.test(
        field,
      ),
    );
    observedFieldCount += merged.matchedFields;
    koemSource.status = 'connected';
    koemSource.message =
      merged.matchedFields > 0
        ? `API 연결 · 부산 정점 ${merged.matchedStations.length}곳 환경값 반영`
        : merged.matchedStations.length > 0
          ? `API 연결 · 부산 정점 확인 · 필드 ${(measurementFields.length > 0 ? measurementFields : merged.receivedFields.slice(6, 30)).join(', ')}`
          : merged.receivedStations.length > 0
            ? `API 연결 · 미매칭 정점 ${merged.receivedStations.slice(0, 3).join(', ')}`
          : 'API 연결 · 부산 후보 정점 응답 없음';
  } else if (koemResult && !koemResult.ok) {
    koemSource.status = 'unavailable';
    koemSource.message = '연결 실패 · 관련 항목은 자료 없음';
    warnings.push(`KOEM 연결 실패: ${describeError(koemResult.error)}`);
  }

  const uniqueOfficialObservations = [
    ...new Map(
      officialObservations.map((item) => [
        `${item.date}-${item.area}`,
        item,
      ]),
    ).values(),
  ];
  const mode = observedFieldCount > 0 ? 'official' : 'unavailable';

  if (mode === 'unavailable') {
    warnings.unshift(
      '연결된 공식 관측값이 없습니다. 임의 수치 대신 자료 없음으로 표시합니다.',
    );
  } else {
    warnings.unshift(
      '공식 관측값만 반영했습니다. 자료가 없는 지표는 비워 두며 위험지수와 미래 예측은 산정하지 않습니다.',
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
