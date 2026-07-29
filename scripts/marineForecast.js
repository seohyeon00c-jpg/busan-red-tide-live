const OPEN_METEO_MARINE_URL =
  'https://marine-api.open-meteo.com/v1/marine';
const DEFAULT_FORECAST_DAYS = 8;
const REQUEST_TIMEOUT = 12000;

const forecastCache = new Map();
const monthlyHistoryCache = new Map();

const isFiniteNumber = (value) => Number.isFinite(Number(value));

function average(values) {
  const validValues = values.filter(isFiniteNumber).map(Number);
  if (validValues.length === 0) return null;

  return (
    validValues.reduce((total, value) => total + value, 0) /
    validValues.length
  );
}

/**
 * Open-Meteo의 시간별 해양 수치예보를 날짜별 평균으로 변환합니다.
 * 실제 API 응답 배열로 쉽게 교체·시험할 수 있도록 집계 로직을 분리했습니다.
 */
export function aggregateHourlyMarineForecast(payload) {
  const hourly = payload?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) {
    throw new Error('해양 예보 응답에 시간 배열이 없습니다.');
  }

  const groupedByDate = new Map();

  hourly.time.forEach((time, index) => {
    const date = String(time).slice(0, 10);
    if (!date) return;

    if (!groupedByDate.has(date)) {
      groupedByDate.set(date, {
        date,
        seaSurfaceTemperature: [],
        oceanCurrentVelocity: [],
        waveHeight: [],
      });
    }

    const dailyValues = groupedByDate.get(date);
    dailyValues.seaSurfaceTemperature.push(
      hourly.sea_surface_temperature?.[index],
    );
    dailyValues.oceanCurrentVelocity.push(
      hourly.ocean_current_velocity?.[index],
    );
    dailyValues.waveHeight.push(hourly.wave_height?.[index]);
  });

  return [...groupedByDate.values()]
    .map((day) => ({
      date: day.date,
      seaSurfaceTemperature: average(day.seaSurfaceTemperature),
      oceanCurrentVelocity: average(day.oceanCurrentVelocity),
      waveHeight: average(day.waveHeight),
      sampleCount: day.seaSurfaceTemperature.filter(isFiniteNumber).length,
    }))
    .filter((day) => Number.isFinite(day.seaSurfaceTemperature));
}

/**
 * 좌표별 8일 해양 수치예보를 가져옵니다.
 * 무료·무키 API이며 실패 시 임의 값으로 대체하지 않고 오류를 반환합니다.
 */
export async function fetchMarineForecast(area, options = {}) {
  const forecastDays = options.forecastDays ?? DEFAULT_FORECAST_DAYS;
  const cacheKey = `${area.id}:${forecastDays}`;

  if (!options.skipCache && forecastCache.has(cacheKey)) {
    return forecastCache.get(cacheKey);
  }

  const request = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout ?? REQUEST_TIMEOUT,
    );

    try {
      const url = new URL(OPEN_METEO_MARINE_URL);
      url.searchParams.set('latitude', String(area.latitude));
      url.searchParams.set('longitude', String(area.longitude));
      url.searchParams.set(
        'hourly',
        [
          'sea_surface_temperature',
          'ocean_current_velocity',
          'wave_height',
        ].join(','),
      );
      url.searchParams.set('timezone', 'Asia/Seoul');
      url.searchParams.set('forecast_days', String(forecastDays));
      url.searchParams.set('cell_selection', 'sea');

      const fetchImplementation =
        options.fetchImplementation ?? globalThis.fetch;
      if (typeof fetchImplementation !== 'function') {
        throw new Error('해양 예보를 요청할 수 없는 실행 환경입니다.');
      }

      const response = await fetchImplementation(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`해양 예보 API 응답 오류: HTTP ${response.status}`);
      }

      const payload = await response.json();
      const days = aggregateHourlyMarineForecast(payload).slice(
        0,
        forecastDays,
      );

      if (days.length === 0) {
        throw new Error('부산 좌표에 사용할 수 있는 해양 예보가 없습니다.');
      }

      return {
        source: 'Open-Meteo Marine API',
        sourceUrl: 'https://open-meteo.com/en/docs/marine-weather-api',
        attribution: 'Open-Meteo · Météo-France·ECMWF 등 수치예보',
        modelData: true,
        latitude: payload.latitude,
        longitude: payload.longitude,
        timezone: payload.timezone,
        units: {
          seaSurfaceTemperature:
            payload.hourly_units?.sea_surface_temperature ?? '°C',
          oceanCurrentVelocity:
            payload.hourly_units?.ocean_current_velocity ?? 'km/h',
          waveHeight: payload.hourly_units?.wave_height ?? 'm',
        },
        days,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('해양 예보 API 요청 시간이 초과되었습니다.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  forecastCache.set(cacheKey, request);

  try {
    return await request;
  } catch (error) {
    forecastCache.delete(cacheKey);
    throw error;
  }
}

/**
 * 부산 여러 좌표의 지정 기간 해양자료를 한 번에 요청합니다.
 * 과거 날짜는 Open-Meteo가 보관한 수치모델 자료이며 관측값이 아닙니다.
 */
export async function fetchMonthlyMarineHistory(areas, options = {}) {
  const startDate = options.startDate;
  const endDate = options.endDate;

  if (!Array.isArray(areas) || areas.length === 0) {
    throw new Error('월간 해양자료를 요청할 해역이 없습니다.');
  }
  if (!startDate || !endDate) {
    throw new Error('월간 해양자료의 시작일과 종료일이 필요합니다.');
  }

  const cacheKey = [
    startDate,
    endDate,
    ...areas.map((area) => area.id),
  ].join(':');

  if (!options.skipCache && monthlyHistoryCache.has(cacheKey)) {
    return monthlyHistoryCache.get(cacheKey);
  }

  const request = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout ?? 20000,
    );

    try {
      const url = new URL(OPEN_METEO_MARINE_URL);
      url.searchParams.set(
        'latitude',
        areas.map((area) => area.latitude).join(','),
      );
      url.searchParams.set(
        'longitude',
        areas.map((area) => area.longitude).join(','),
      );
      url.searchParams.set(
        'hourly',
        [
          'sea_surface_temperature',
          'ocean_current_velocity',
          'wave_height',
        ].join(','),
      );
      url.searchParams.set('timezone', 'Asia/Seoul');
      url.searchParams.set('start_date', startDate);
      url.searchParams.set('end_date', endDate);
      url.searchParams.set('cell_selection', 'sea');

      const fetchImplementation =
        options.fetchImplementation ?? globalThis.fetch;
      if (typeof fetchImplementation !== 'function') {
        throw new Error('월간 해양자료를 요청할 수 없는 실행 환경입니다.');
      }

      const response = await fetchImplementation(url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `월간 해양자료 API 응답 오류: HTTP ${response.status}`,
        );
      }

      const payload = await response.json();
      const payloads = Array.isArray(payload) ? payload : [payload];
      const areaHistories = areas.map((area, index) => ({
        areaId: area.id,
        areaName: area.name,
        days: aggregateHourlyMarineForecast(payloads[index] ?? {}),
      }));

      if (areaHistories.every((history) => history.days.length === 0)) {
        throw new Error('부산 좌표에 사용할 수 있는 과거 해양자료가 없습니다.');
      }

      return {
        source: 'Open-Meteo Marine API',
        sourceUrl: 'https://open-meteo.com/en/docs/marine-weather-api',
        attribution: 'Open-Meteo 과거 해양 수치모델 자료',
        startDate,
        endDate,
        areas: areaHistories,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('월간 해양자료 API 요청 시간이 초과되었습니다.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  monthlyHistoryCache.set(cacheKey, request);

  try {
    return await request;
  } catch (error) {
    monthlyHistoryCache.delete(cacheKey);
    throw error;
  }
}
