import { marineAreas } from './data.js';
import {
  compareOfficialThreshold,
  getRiskColor,
} from './risk.js?v=20260729-monthly-risk-v6';
import { initializeBusanMap } from './map.js?v=20260729-monthly-risk-v6';
import { createDataBriefing } from './briefing.js';
import {
  initializeMonthlyRiskCalendar,
} from './calendar.js?v=20260729-monthly-risk-v6';
import { loadPublicMarineData } from './publicData.js?v=20260729-monthly-risk-v6';
import { createSevenDayForecast } from './forecast.js?v=20260729-monthly-risk-v6';
import { fetchMarineForecast } from './marineForecast.js?v=20260729-monthly-risk-v6';

const numberFormatter = new Intl.NumberFormat('ko-KR');
let activeAreas = marineAreas;
let dashboardState;
let selectedAreaId = activeAreas[0]?.id;
let mapController;
let forecastRequestId = 0;

function getObservedFieldCount(area) {
  return Object.values(area.dataStatus?.fields ?? {}).filter(
    (status) => status === 'observed',
  ).length;
}

function getObservedAreas(areas) {
  return areas.filter((area) => getObservedFieldCount(area) > 0);
}

function getObservedTemperatureAverage(areas) {
  const temperatures = areas
    .filter(
      (area) =>
        area.dataStatus?.fields?.waterTemperature === 'observed' &&
        Number.isFinite(area.waterTemperature),
    )
    .map((area) => area.waterTemperature);

  if (temperatures.length === 0) return '–';
  return (
    temperatures.reduce((sum, temperature) => sum + temperature, 0) /
    temperatures.length
  ).toFixed(1);
}

const statDefinitions = [
  {
    icon: 'database',
    label: '공식 관측 해역',
    value: (areas) => getObservedAreas(areas).length,
    unit: '개 해역',
    note: '공식값이 1개 이상 연결된 해역',
    color: 'teal',
  },
  {
    icon: 'thermometer-sun',
    label: '공식 관측 평균 수온',
    value: getObservedTemperatureAverage,
    unit: '℃',
    note: '공식 수온이 있는 해역만 평균',
    color: 'sky',
  },
  {
    icon: 'list-checks',
    label: '공식 관측 항목',
    value: (areas) =>
      areas.reduce((total, area) => total + getObservedFieldCount(area), 0),
    unit: '개',
    note: '예시·임의 보간값 제외',
    color: 'rose',
  },
  {
    icon: 'shield-alert',
    label: 'NIFS 적조 확인',
    value: () => dashboardState?.officialObservations?.length ?? 0,
    unit: '건',
    note: '현재 월 연결 기록',
    color: 'slate',
  },
];

const iconColorClasses = {
  rose: 'bg-rose-50 text-rose-600',
  sky: 'bg-sky-50 text-sky-600',
  teal: 'bg-teal-50 text-teal-600',
  slate: 'bg-slate-100 text-slate-600',
};

const detailMetricDefinitions = [
  {
    key: 'cellDensity',
    label: '적조생물 세포밀도',
    icon: 'activity',
    format: (value) => numberFormatter.format(value),
    unit: 'cells/mL',
    description:
      '적조생물의 양을 직접 나타내는 핵심 지표입니다. 값이 빠르게 늘수록 적조 발생·확산 가능성이 커질 수 있습니다.',
  },
  {
    key: 'waterTemperature',
    label: '수온',
    icon: 'thermometer',
    format: (value) => value.toFixed(1),
    unit: '℃',
    description:
      '코클로디니움은 대체로 24~27℃에서 증식에 유리해, 이 범위의 수온이 위험도를 높일 수 있습니다.',
  },
  {
    key: 'chlorophyllA',
    label: '엽록소-a',
    icon: 'flask-conical',
    format: (value) => value.toFixed(1),
    unit: 'µg/L',
    description:
      '식물플랑크톤 생물량을 간접적으로 보여줍니다. 높은 값은 적조생물 증식 환경을 살피는 보조 신호입니다.',
  },
  {
    key: 'salinity',
    label: '염분',
    icon: 'waves',
    format: (value) => value.toFixed(1),
    unit: 'PSU',
    description:
      '염분은 적조생물의 생존과 성장에 영향을 줍니다. 종별 적정 범위에 가까우면 증식 가능성이 커질 수 있습니다.',
  },
  {
    key: 'dissolvedOxygen',
    label: '용존산소',
    icon: 'droplets',
    format: (value) => value.toFixed(1),
    unit: 'mg/L',
    description:
      '적조가 심해지거나 사멸 과정이 진행되면 산소가 감소할 수 있습니다. 낮은 값은 어패류 피해 위험과 연관됩니다.',
  },
  {
    key: 'ph',
    label: 'pH',
    icon: 'beaker',
    format: (value) => value.toFixed(2),
    unit: '',
    description:
      '광합성과 유기물 분해에 따라 pH가 변할 수 있습니다. 급격한 변화는 플랑크톤 활동과 수질 변화를 살피는 보조 신호입니다.',
  },
];

const sourceStatusMeta = {
  connected: {
    label: '연결',
    icon: 'circle-check',
  },
  ready: {
    label: '연동 준비',
    icon: 'settings-2',
  },
  unavailable: {
    label: '미연결',
    icon: 'triangle-alert',
  },
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getFieldSource(area, field) {
  return area.dataStatus?.fields?.[field] === 'observed'
    ? {
        label: '관측',
        value: 'observed',
      }
    : {
        label: '자료 없음',
        value: 'unavailable',
      };
}

function renderSystemState() {
  const official = dashboardState.mode === 'official';
  const headerStatus = document.querySelector('#header-system-status');
  const banner = document.querySelector('#system-mode-banner');
  const sourceModeBadge = document.querySelector('#source-mode-badge');
  const footerDataStatus = document.querySelector('#footer-data-status');

  headerStatus.dataset.mode = dashboardState.mode;
  document.querySelector('#header-system-status-text').textContent = official
    ? '공식 데이터 모드'
    : '공식자료 없음';

  banner.dataset.mode = dashboardState.mode;
  document.querySelector('#system-mode-title').textContent = official
    ? '공공기관의 공식 관측값만 표시합니다.'
    : '현재 연결된 공식 관측값이 없습니다.';
  document.querySelector('#system-mode-message').textContent =
    dashboardState.warnings[0];
  document.querySelector('#system-mode-label').textContent = official
    ? 'OFFICIAL DATA'
    : 'NO OFFICIAL DATA';

  sourceModeBadge.textContent = official
    ? '관측·예보 출처 분리'
    : '공식자료 없음';
  sourceModeBadge.dataset.mode = dashboardState.mode;

  document.querySelector('#hero-reference-label').textContent = official
    ? `${formatReferenceTime(dashboardState.updatedAt)} 연결 확인`
    : '공식 관측자료 없음';

  if (footerDataStatus) {
    footerDataStatus.textContent = '연구·교육용 프로토타입';
  }
}

function renderDataSources() {
  const container = document.querySelector('#data-source-grid');
  const warningList = document.querySelector('#data-warning-list');
  if (!container || !warningList) return;

  const displayedSources = [
    ...dashboardState.sources,
    {
      agency: 'Open-Meteo',
      dataset: 'Marine API 해양 수치예보',
      status: 'connected',
      message: '무료·무키 연동 · 좌표별 해수면수온·해류·파고 8일 예보',
    },
  ];

  container.innerHTML = displayedSources
    .map((source) => {
      const meta = sourceStatusMeta[source.status];
      return `
        <article
          class="source-card rounded-lg border border-white/10 bg-white/[0.045] p-4"
          data-status="${source.status}"
        >
          <div class="flex items-start justify-between gap-3">
            <span class="source-status-icon grid h-9 w-9 place-items-center rounded-lg">
              <i data-lucide="${meta.icon}" class="h-5 w-5"></i>
            </span>
            <span class="source-status-label rounded px-2 py-1 text-[8px] font-bold">
              ${meta.label}
            </span>
          </div>
          <h3 class="mt-4 text-xs font-bold text-slate-100">${escapeHtml(source.agency)}</h3>
          <p class="mt-1 min-h-8 text-[9px] leading-4 text-slate-400">${escapeHtml(source.dataset)}</p>
          <small class="mt-3 block border-t border-white/10 pt-3 text-[8px] leading-4 text-slate-500">
            ${escapeHtml(source.message)}
          </small>
        </article>
      `;
    })
    .join('');

  warningList.innerHTML = dashboardState.warnings
    .map(
      (warning) => `
        <div class="flex items-start gap-2 rounded-md border border-amber-300/10 bg-amber-300/[0.055] px-3 py-2 text-[9px] leading-4 text-amber-100/70">
          <i data-lucide="info" class="mt-0.5 h-3.5 w-3.5 shrink-0"></i>
          <span>${escapeHtml(warning)}</span>
        </div>
      `,
    )
    .join('');
}

function initializeMobileNavigation() {
  const button = document.querySelector('#mobile-menu-button');
  const navigation = document.querySelector('#mobile-navigation');
  if (!button || !navigation) return;

  const setOpen = (open) => {
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute(
      'aria-label',
      open ? '모바일 메뉴 닫기' : '모바일 메뉴 열기',
    );
    button.innerHTML = `
      <i data-lucide="${open ? 'x' : 'menu'}" class="h-5 w-5"></i>
    `;
    navigation.dataset.open = String(open);
    navigation.setAttribute('aria-hidden', String(!open));

    if (window.lucide) {
      window.lucide.createIcons();
    }
  };

  button.addEventListener('click', () => {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });

  navigation.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      button.getAttribute('aria-expanded') === 'true'
    ) {
      setOpen(false);
      button.focus();
    }
  });

  window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });

  setOpen(false);
}

function initializeMetricHelp() {
  const metrics = document.querySelector('#detail-metrics');
  if (!metrics) return;

  const closeAll = (exceptButton) => {
    metrics.querySelectorAll('[data-metric-help]').forEach((button) => {
      if (button === exceptButton) return;
      button.setAttribute('aria-expanded', 'false');
      button.closest('.metric-help').dataset.open = 'false';
    });
  };

  metrics.addEventListener('click', (event) => {
    const button = event.target.closest('[data-metric-help]');
    if (!button) return;

    const open = button.getAttribute('aria-expanded') !== 'true';
    closeAll(button);
    button.setAttribute('aria-expanded', String(open));
    button.closest('.metric-help').dataset.open = String(open);
    event.stopPropagation();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.metric-help')) closeAll();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openButton = metrics.querySelector(
      '[data-metric-help][aria-expanded="true"]',
    );
    if (!openButton) return;
    closeAll();
    openButton.focus();
  });
}

function renderToday() {
  const todayElement = document.querySelector('#today-label');
  const today = new Date();
  todayElement.textContent = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(today);
}

function renderTopRiskArea(topRisk) {
  const isLoading = topRisk === undefined;
  const color = topRisk ? getRiskColor(topRisk.today.score) : '#94a3b8';
  const topAreaName = document.querySelector('#top-area-name');
  const topAreaSubtitle = document.querySelector('#top-area-subtitle');
  const topRiskScore = document.querySelector('#top-risk-score');
  const topRiskLevel = document.querySelector('#top-risk-level');
  const topRiskBar = document.querySelector('#top-risk-bar');

  topAreaName.textContent = topRisk?.area.name ?? (isLoading ? '계산 중' : '자료 없음');
  topAreaSubtitle.textContent = topRisk
    ? '최신 공개 데이터·해양예보 기준'
    : isLoading
      ? '6개 해역의 오늘 위험지수를 계산하고 있습니다.'
      : '계산 가능한 최신 해양예보가 없습니다.';
  topRiskScore.textContent = topRisk?.today.score ?? (isLoading ? '…' : '–');
  topRiskScore.style.color = color;
  topRiskLevel.textContent = topRisk?.today.level ?? (isLoading ? '계산 중' : '자료 없음');
  topRiskLevel.style.color = color;
  topRiskBar.style.width = `${topRisk?.today.score ?? 0}%`;
  topRiskBar.style.backgroundColor = color;
  document.querySelector('#top-data-note').innerHTML = `
    <i data-lucide="info" class="mt-0.5 h-3.5 w-3.5 shrink-0"></i>
    지도 마커·상세 카드·주간 오늘값과 같은 0~100 계산 결과입니다.
    공식 적조특보와는 별개의 연구·교육용 모델 위험지수입니다.
  `;
}

function formatReferenceTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '시각 정보 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function renderAreaDetail(area) {
  const riskColor = '#94a3b8';
  const riskGauge = document.querySelector('#selected-risk-gauge');
  const riskGaugeLabel = document.querySelector(
    '#selected-risk-gauge-label',
  );
  const metrics = document.querySelector('#detail-metrics');
  const dataBadge = document.querySelector('#selected-data-badge');
  const organismSource = getFieldSource(area, 'organism');

  document.querySelector('#selected-area-name').textContent = area.name;
  document.querySelector('#selected-area-detail').textContent = area.detail;
  document.querySelector('#selected-risk-score').textContent = '…';
  document.querySelector('#selected-risk-level').textContent =
    '날짜별 해양예보 연결 중';
  document.querySelector('#selected-risk-level').style.color = riskColor;
  riskGaugeLabel.textContent = '계산 중';
  document.querySelector('#selected-organism').textContent =
    organismSource.value === 'observed' ? area.organism : '자료 없음';
  document.querySelector('#selected-organism-source').textContent =
    organismSource.label;
  document.querySelector('#selected-organism-source').dataset.source =
    organismSource.value;
  document.querySelector('#selected-reference-time').textContent =
    `${formatReferenceTime(area.referenceTime)} 기준`;
  const densityObserved =
    area.dataStatus?.fields?.cellDensity === 'observed' &&
    Number.isFinite(area.cellDensity);
  document.querySelector('#selected-official-comparison').textContent =
    densityObserved
      ? `공식 세포밀도 기준 비교 · ${compareOfficialThreshold(area.cellDensity)}`
      : '공식 세포밀도 자료 없음 · 기준 비교 불가';

  riskGauge.style.setProperty('--risk-color', riskColor);
  riskGauge.style.setProperty('--risk-angle', '0deg');
  dataBadge.textContent = getObservedFieldCount(area) > 0
    ? '공식 관측 데이터'
    : '공식 관측자료 없음';
  dataBadge.dataset.mode = area.dataStatus.measurements;

  metrics.innerHTML = detailMetricDefinitions
    .map((metric) => {
      const source = getFieldSource(area, metric.key);
      const hasValue =
        source.value === 'observed' && Number.isFinite(area[metric.key]);
      return `
        <div class="metric-card grid grid-cols-[auto_1fr] items-center gap-x-2 rounded-lg border border-slate-200 p-2.5">
          <span class="row-span-2 grid h-8 w-8 place-items-center rounded-md bg-teal-50 text-teal-700">
            <i data-lucide="${metric.icon}" class="h-4 w-4"></i>
          </span>
          <span class="flex items-center justify-between gap-1 text-[8px] font-medium text-slate-500">
            ${metric.label}
            <span class="flex items-center gap-1">
              <small class="metric-source" data-source="${source.value}">${source.label}</small>
              <span class="metric-help" data-open="false">
                <button
                  type="button"
                  class="metric-help-button"
                  data-metric-help
                  aria-expanded="false"
                  aria-controls="metric-help-${metric.key}"
              aria-label="${metric.label} 지표와 적조의 연관 설명"
                >···</button>
                <span
                  id="metric-help-${metric.key}"
                  class="metric-help-popover"
                  role="tooltip"
                >${escapeHtml(metric.description)}</span>
              </span>
            </span>
          </span>
          <strong class="text-sm font-extrabold text-ocean-900">
            ${hasValue ? metric.format(area[metric.key]) : '자료 없음'}
            ${
              hasValue
                ? `<small class="text-[7px] font-medium text-slate-400">${metric.unit}</small>`
                : ''
            }
          </strong>
        </div>
      `;
    })
    .join('');

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 선택 해역 상세 카드와 주간 전망의 오늘 값을 하나의 점수로 맞춥니다.
 */
function renderSelectedModelRisk(day) {
  const riskGauge = document.querySelector('#selected-risk-gauge');
  const riskScore = document.querySelector('#selected-risk-score');
  const riskLevel = document.querySelector('#selected-risk-level');
  const riskGaugeLabel = document.querySelector(
    '#selected-risk-gauge-label',
  );

  if (!riskGauge || !riskScore || !riskLevel || !riskGaugeLabel) return;

  if (!day) {
    riskScore.textContent = '–';
    riskLevel.textContent = '예측자료 없음 · 산정 안 함';
    riskLevel.style.color = '#94a3b8';
    riskGaugeLabel.textContent = '자료 없음';
    riskGauge.style.setProperty('--risk-color', '#94a3b8');
    riskGauge.style.setProperty('--risk-angle', '0deg');
    riskGauge.setAttribute('aria-label', '자체 모델 위험지수 자료 없음');
    return;
  }

  const riskColor = getRiskColor(day.score);
  riskScore.textContent = day.score;
  riskLevel.textContent = `${day.level} · 지도·주간 오늘값과 동일`;
  riskLevel.style.color = riskColor;
  riskGaugeLabel.textContent = '모델 위험';
  riskGauge.style.setProperty('--risk-color', riskColor);
  riskGauge.style.setProperty('--risk-angle', `${day.score * 3.6}deg`);
  riskGauge.setAttribute(
    'aria-label',
    `자체 모델 위험지수 ${day.score}점 ${day.level}`,
  );
}

function renderDataBriefing(area) {
  const briefing = createDataBriefing(area);
  const signalsElement = document.querySelector('#briefing-signals');

  document.querySelector('#briefing-title').textContent =
    `${area.name} 해역 자동 해설`;
  document.querySelector('#briefing-summary').textContent = briefing.summary;
  document.querySelector('#briefing-action').textContent = briefing.action;
  document.querySelector('#briefing-disclaimer').innerHTML = `
    <i data-lucide="info" class="mt-0.5 h-3.5 w-3.5 shrink-0"></i>
    <span>${briefing.disclaimer}</span>
  `;

  signalsElement.innerHTML = briefing.signals
    .map(
      (signal) => `
        <div
          class="briefing-signal rounded-lg border px-3 py-2.5"
          data-tone="${signal.tone}"
        >
          <span class="block text-[8px] opacity-70">${signal.label}</span>
          <strong class="mt-1 block text-[10px]">${signal.value}</strong>
        </div>
      `,
    )
    .join('');

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function renderSevenDayForecast(area) {
  const requestId = ++forecastRequestId;
  const chart = document.querySelector('#forecast-chart');
  const summary = document.querySelector('#forecast-summary');
  const sourceNote = document.querySelector('#forecast-source-note');
  if (!chart || !summary) return;

  document.querySelector('#forecast-area-title').textContent =
    `${area.name} 해역 주간 적조 위험 전망`;

  summary.innerHTML = `
    <article class="forecast-summary-card sm:col-span-2">
      <span>주간 해양예보</span>
      <strong class="text-slate-600">자료 불러오는 중</strong>
      <small>선택 해역의 날짜별 수온·해류·파고를 확인하고 있습니다.</small>
    </article>
  `;
  chart.innerHTML = `
    <p class="col-span-full py-10 text-center text-xs text-slate-500">
      해양 수치예보를 불러오는 중입니다.
    </p>
  `;
  if (sourceNote) {
    sourceNote.textContent = '날짜별 해양 수치예보 연결 중';
  }

  let marineForecast;
  try {
    marineForecast = await fetchMarineForecast(area);
  } catch (error) {
    if (requestId !== forecastRequestId) return;

    console.warn('주간 해양 수치예보를 불러오지 못했습니다.', error);
    summary.innerHTML = `
      <article class="forecast-summary-card sm:col-span-2">
        <span>주간 예측</span>
        <strong class="text-slate-500">예측자료 없음</strong>
        <small>해양예보 연결에 실패해 임의 값으로 대체하지 않았습니다.</small>
      </article>
    `;
    chart.innerHTML = `
      <p class="col-span-full py-10 text-center text-xs text-slate-500">
        날짜별 해양 예보자료를 가져오지 못했습니다.
      </p>
    `;
    if (sourceNote) {
      sourceNote.textContent = 'Open-Meteo Marine API 연결 실패';
    }
    mapController?.updateRiskScore(area.id, null);
    renderSelectedModelRisk(null);
    return;
  }

  if (requestId !== forecastRequestId || area.id !== selectedAreaId) return;

  const forecast = createSevenDayForecast(area, marineForecast);

  if (!forecast.available) {
    summary.innerHTML = `
      <article class="forecast-summary-card sm:col-span-2">
        <span>주간 예측</span>
        <strong class="text-slate-500">예측자료 없음</strong>
        <small>날짜별 해수면수온 예보가 없어 계산하지 않았습니다.</small>
      </article>
    `;
    chart.innerHTML = `
      <p class="col-span-full py-10 text-center text-xs text-slate-500">
        예측 자료가 없습니다.
      </p>
    `;
    if (sourceNote) {
      sourceNote.textContent = '사용 가능한 날짜별 해수면수온 예보 없음';
    }
    mapController?.updateRiskScore(area.id, null);
    renderSelectedModelRisk(null);
    return;
  }

  const firstDay = forecast.days[0];
  mapController?.updateRiskScore(area.id, {
    score: firstDay.score,
    level: firstDay.level,
    color: getRiskColor(firstDay.score),
  });
  renderSelectedModelRisk(firstDay);
  summary.innerHTML = `
    <article class="forecast-summary-card">
      <span>오늘 모델 위험도</span>
      <strong style="color:${getRiskColor(firstDay.score)}">${firstDay.score}점</strong>
      <small>${firstDay.level} · 예측 수온 ${firstDay.seaSurfaceTemperature.toFixed(1)}℃</small>
    </article>
    <article class="forecast-summary-card">
      <span>주간 최고 전망</span>
      <strong style="color:${getRiskColor(forecast.peak.score)}">${forecast.peak.score}점</strong>
      <small>${forecast.peak.dateLabel} ${forecast.peak.weekday}</small>
    </article>
    <article class="forecast-summary-card" data-direction="${forecast.direction.key}">
      <span>위험도 흐름</span>
      <strong class="flex items-center gap-2">
        <i data-lucide="${forecast.direction.icon}" class="h-5 w-5"></i>
        ${forecast.direction.label}
      </strong>
      <small>${forecast.direction.description}</small>
    </article>
    <article class="forecast-summary-card">
      <span>예측자료 충족도</span>
      <strong>${firstDay.inputCoverage}%</strong>
      <small>공식 세포밀도 ${forecast.hasCellDensity ? '포함' : '미포함'}</small>
    </article>
  `;

  chart.innerHTML = forecast.days
    .map((day) => {
      const color = getRiskColor(day.score);
      return `
        <article
          class="forecast-day"
          role="listitem"
          aria-label="${day.dateLabel} ${day.weekday}, 적조 위험 ${day.score}점 ${day.level}"
        >
          <div class="forecast-day__heading">
            <span>${day.weekday}</span>
            <strong>${day.score}</strong>
          </div>
          <div class="forecast-bar-track" aria-hidden="true">
            <span
              class="forecast-bar"
              style="height:${Math.max(8, day.score)}%;--forecast-color:${color}"
            ></span>
          </div>
          <strong class="forecast-day__level" style="color:${color}">
            ${day.level}
          </strong>
          <span class="forecast-day__date">${day.dateLabel}</span>
          <small>
            ${day.seaSurfaceTemperature.toFixed(1)}℃ ·
            파고 ${Number.isFinite(day.waveHeight) ? day.waveHeight.toFixed(1) : '–'}m
          </small>
        </article>
      `;
    })
    .join('');

  if (sourceNote) {
    sourceNote.textContent =
      `${forecast.attribution} · 해수면수온·해류·파고 예보 사용`;
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 최신 공개 데이터 캐시와 좌표별 해양 수치예보를 결합해
 * 6개 해역의 오늘 위험점수를 지도에 각각 표시합니다.
 */
async function renderMapRiskScores() {
  const riskResults = await Promise.all(
    activeAreas.map(async (area) => {
      try {
        const marineForecast = await fetchMarineForecast(area);
        const forecast = createSevenDayForecast(area, marineForecast);
        const today = forecast.available ? forecast.days[0] : null;

        mapController?.updateRiskScore(
          area.id,
          today
            ? {
                score: today.score,
                level: today.level,
                color: getRiskColor(today.score),
              }
            : null,
        );
        return today ? { area, today } : null;
      } catch (error) {
        console.warn(
          `${area.name} 지도 위험점수를 계산하지 못했습니다.`,
          error,
        );
        mapController?.updateRiskScore(area.id, null);
        return null;
      }
    }),
  );

  const topRisk = riskResults
    .filter(Boolean)
    .reduce(
      (highest, current) =>
        !highest || current.today.score > highest.today.score
          ? current
          : highest,
      null,
    );
  renderTopRiskArea(topRisk);
}

function updateAreaCardSelection() {
  document.querySelectorAll('[data-area-id]').forEach((card) => {
    card.setAttribute(
      'aria-pressed',
      String(card.dataset.areaId === selectedAreaId),
    );
  });
}

function selectArea(areaId, options = {}) {
  const area = activeAreas.find((item) => item.id === areaId);
  if (!area) return;

  selectedAreaId = areaId;
  renderAreaDetail(area);
  renderDataBriefing(area);
  renderSevenDayForecast(area);
  updateAreaCardSelection();
  mapController?.selectArea(areaId, {
    moveMap: Boolean(options.moveMap),
  });
}

function renderSummary() {
  const container = document.querySelector('#summary-grid');

  container.innerHTML = statDefinitions
    .map(
      (stat) => `
        <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <span class="grid h-10 w-10 place-items-center rounded-lg ${iconColorClasses[stat.color]}">
              <i data-lucide="${stat.icon}" class="h-5 w-5"></i>
            </span>
            <span class="rounded bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700">
              ${dashboardState.mode === 'official' ? '공식 데이터' : '자료 없음'}
            </span>
          </div>
          <p class="mt-4 text-[10px] font-semibold text-slate-500">${stat.label}</p>
          <strong class="mt-1 block text-2xl font-extrabold tracking-tight text-ocean-900">
            ${stat.value(activeAreas)}
            <small class="text-[10px] font-medium text-slate-500">${stat.unit}</small>
          </strong>
          <span class="mt-2 block text-[9px] text-slate-400">${stat.note}</span>
        </article>
      `,
    )
    .join('');
}

function renderAreas() {
  const container = document.querySelector('#area-grid');

  container.innerHTML = activeAreas
    .map((area) => {
      const observedFieldCount = getObservedFieldCount(area);
      const color = observedFieldCount > 0 ? '#0f766e' : '#94a3b8';
      const densityObserved =
        area.dataStatus?.fields?.cellDensity === 'observed' &&
        Number.isFinite(area.cellDensity);
      const officialComparison = densityObserved
        ? compareOfficialThreshold(area.cellDensity)
        : '자료 없음';
      const dataModeLabel =
        observedFieldCount > 0 ? '공식 관측 데이터' : '공식 관측자료 없음';
      const formatAreaValue = (field, formatter) =>
        area.dataStatus?.fields?.[field] === 'observed' &&
        Number.isFinite(area[field])
          ? formatter(area[field])
          : '자료 없음';

      return `
        <button
          type="button"
          class="area-select-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-panel"
          data-area-id="${area.id}"
          aria-pressed="${area.id === selectedAreaId}"
          aria-label="${area.name} 해역 선택"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full" style="background:${color}"></span>
                <h3 class="font-extrabold text-ocean-900">${area.name}</h3>
              </div>
              <p class="mt-1 text-[10px] text-slate-500">${area.detail}</p>
            </div>
            <div class="text-right">
              <strong class="block text-2xl font-extrabold text-teal-700">
                ${observedFieldCount}
              </strong>
              <span class="text-[9px] font-bold text-slate-500">공식 관측항목</span>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-3 gap-2 border-y border-slate-100 py-3">
            <div>
              <span class="block text-[8px] text-slate-400">세포밀도</span>
              <strong class="mt-1 block text-xs text-slate-800">
                ${formatAreaValue('cellDensity', (value) => `${numberFormatter.format(value)} cells/mL`)}
              </strong>
            </div>
            <div>
              <span class="block text-[8px] text-slate-400">수온</span>
              <strong class="mt-1 block text-xs text-slate-800">
                ${formatAreaValue('waterTemperature', (value) => `${value.toFixed(1)}℃`)}
              </strong>
            </div>
            <div>
              <span class="block text-[8px] text-slate-400">Chl-a</span>
              <strong class="mt-1 block text-xs text-slate-800">
                ${formatAreaValue('chlorophyllA', (value) => `${value.toFixed(1)} µg/L`)}
              </strong>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span
              class="rounded bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700"
              data-mode="${area.dataStatus.measurements}"
            >
              ${dataModeLabel}
            </span>
            <span class="text-[9px] text-slate-500" title="실제 공식 특보 발령이 아닙니다.">
              공식 기준 비교: <b>${officialComparison}</b>
            </span>
          </div>
          <p class="mt-3 text-[9px] leading-4 text-slate-400">
            좌표 ${area.latitude.toFixed(4)}, ${area.longitude.toFixed(4)} ·
            공식특보 발령 정보 없음
          </p>
        </button>
      `;
    })
    .join('');

  container.querySelectorAll('[data-area-id]').forEach((card) => {
    card.addEventListener('click', () => {
      selectArea(card.dataset.areaId, { moveMap: true });
    });
  });
}

async function initializeApp() {
  initializeMobileNavigation();
  initializeMetricHelp();
  renderToday();

  try {
    dashboardState = await loadPublicMarineData(marineAreas);
  } catch (error) {
    console.error('공식 공공데이터 초기화에 실패했습니다.', error);
    dashboardState = await loadPublicMarineData(marineAreas, {
      skipCache: true,
      config: {},
    });
    dashboardState.warnings.push(
      '데이터 처리 중 오류가 발생해 공식 관측값을 표시할 수 없습니다.',
    );
  }
  activeAreas = dashboardState.areas;
  selectedAreaId = activeAreas[0]?.id;

  renderSystemState();
  renderTopRiskArea();
  renderSummary();
  renderAreas();
  renderDataSources();
  mapController = initializeBusanMap(activeAreas, selectArea);
  void renderMapRiskScores();
  selectArea(selectedAreaId);
  void initializeMonthlyRiskCalendar({
    areas: activeAreas,
  });

  // 동적으로 추가된 아이콘까지 한 번에 활성화합니다.
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

initializeApp();
