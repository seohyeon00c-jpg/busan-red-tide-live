import {
  createDemoHourlyTrend,
  marineAreas as demoMarineAreas,
} from './data.js';
import {
  RISK_WEIGHTS,
  compareOfficialThreshold,
  getRiskColor,
} from './risk.js';
import { initializeBusanMap } from './map.js';
import { createDataBriefing } from './briefing.js';
import {
  initializeMonthlyRiskCalendar,
} from './calendar.js';
import { loadPublicMarineData } from './publicData.js';

const numberFormatter = new Intl.NumberFormat('ko-KR');
let activeAreas = demoMarineAreas;
let dashboardState;
let selectedAreaId = activeAreas[0]?.id;
let mapController;

const CHART = Object.freeze({
  width: 760,
  height: 280,
  padding: {
    top: 28,
    right: 52,
    bottom: 38,
    left: 54,
  },
});

const riskTextClass = (score) => {
  if (score >= 80) return 'text-red-900';
  if (score >= 60) return 'text-red-600';
  if (score >= 40) return 'text-orange-600';
  if (score >= 20) return 'text-amber-600';
  return 'text-teal-600';
};

const statDefinitions = [
  {
    icon: 'gauge',
    label: '최고 자체 위험지수',
    value: (areas) => `${Math.max(...areas.map((area) => area.riskScore))}`,
    unit: '/100',
    note: '시연 계산값',
    color: 'rose',
  },
  {
    icon: 'thermometer-sun',
    label: '6개 해역 평균 수온',
    value: (areas) =>
      (
        areas.reduce((sum, area) => sum + area.waterTemperature, 0) /
        areas.length
      ).toFixed(1),
    unit: '℃',
    note: '예시 관측값 평균',
    color: 'sky',
  },
  {
    icon: 'map-pin',
    label: '모니터링 대상',
    value: (areas) => areas.length,
    unit: '개 해역',
    note: '실제 위·경도 정의',
    color: 'teal',
  },
  {
    icon: 'shield-alert',
    label: '공식 특보',
    value: () => '미연결',
    unit: '',
    note: '임의 발령 표시 없음',
    color: 'slate',
  },
];

const iconColorClasses = {
  rose: 'bg-rose-50 text-rose-600',
  sky: 'bg-sky-50 text-sky-600',
  teal: 'bg-teal-50 text-teal-600',
  slate: 'bg-slate-100 text-slate-600',
};

const weightLabels = {
  cellDensity: '세포밀도',
  temperature: '수온 적합성',
  chlorophyllA: 'Chl-a',
  salinity: '염분',
  dissolvedOxygen: '용존산소',
  growthTrend: '최근 증가 추세',
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
        label: '예시',
        value: 'demo',
      };
}

function renderSystemState() {
  const hybrid = dashboardState.mode === 'hybrid';
  const headerStatus = document.querySelector('#header-system-status');
  const banner = document.querySelector('#system-mode-banner');
  const sourceModeBadge = document.querySelector('#source-mode-badge');

  headerStatus.dataset.mode = dashboardState.mode;
  document.querySelector('#header-system-status-text').textContent = hybrid
    ? '공식·예시 혼합모드'
    : '시연모드';

  banner.dataset.mode = dashboardState.mode;
  document.querySelector('#system-mode-title').textContent = hybrid
    ? '일부 공식 관측값과 예시 환경값을 함께 표시합니다.'
    : '현재 모든 해양 수치는 예시 데이터입니다.';
  document.querySelector('#system-mode-message').textContent =
    dashboardState.warnings[0];
  document.querySelector('#system-mode-label').textContent = hybrid
    ? 'HYBRID DATA'
    : 'DEMO DATA';

  sourceModeBadge.textContent = hybrid
    ? '공식·예시 혼합모드'
    : '안전한 시연모드';
  sourceModeBadge.dataset.mode = dashboardState.mode;

  document.querySelector('#hero-reference-label').textContent = hybrid
    ? `${formatReferenceTime(dashboardState.updatedAt)} 연결 확인`
    : '2026.07.28 초기 시연 스냅샷';
}

function renderDataSources() {
  const container = document.querySelector('#data-source-grid');
  const warningList = document.querySelector('#data-warning-list');
  if (!container || !warningList) return;

  container.innerHTML = dashboardState.sources
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

function renderTopRiskArea() {
  const topArea = [...activeAreas].sort(
    (first, second) => second.riskScore - first.riskScore,
  )[0];
  const color = getRiskColor(topArea.riskScore);

  document.querySelector('#top-area-name').textContent = topArea.name;
  document.querySelector('#top-area-subtitle').textContent = topArea.detail;
  document.querySelector('#top-risk-score').textContent = topArea.riskScore;
  document.querySelector('#top-risk-score').style.color = color;
  document.querySelector('#top-risk-level').textContent = topArea.riskLevel;
  document.querySelector('#top-risk-level').style.color = color;
  document.querySelector('#top-risk-bar').style.width = `${topArea.riskScore}%`;
  document.querySelector('#top-risk-bar').style.backgroundColor = color;
  document.querySelector('#top-data-note').innerHTML = `
    <i data-lucide="info" class="mt-0.5 h-3.5 w-3.5 shrink-0"></i>
    ${
      topArea.dataStatus.measurements === 'hybrid'
        ? '일부 공식 관측값과 예시 환경값을 함께 사용한 파생지수입니다. 공식 특보가 아닙니다.'
        : '이 값은 예시 해양환경 자료로 계산한 시연용 파생지수입니다. 실제 관측이나 공식 특보가 아닙니다.'
    }
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
  const riskColor = getRiskColor(area.riskScore);
  const riskGauge = document.querySelector('#selected-risk-gauge');
  const metrics = document.querySelector('#detail-metrics');
  const dataBadge = document.querySelector('#selected-data-badge');
  const organismSource = getFieldSource(area, 'organism');

  document.querySelector('#selected-area-name').textContent = area.name;
  document.querySelector('#selected-area-detail').textContent = area.detail;
  document.querySelector('#selected-risk-score').textContent = area.riskScore;
  document.querySelector('#selected-risk-level').textContent =
    `${area.riskLevel} · ${area.riskScore}점`;
  document.querySelector('#selected-risk-level').style.color = riskColor;
  document.querySelector('#selected-organism').textContent = area.organism;
  document.querySelector('#selected-organism-source').textContent =
    organismSource.label;
  document.querySelector('#selected-organism-source').dataset.source =
    organismSource.value;
  document.querySelector('#selected-reference-time').textContent =
    `${formatReferenceTime(area.referenceTime)} 기준`;
  document.querySelector('#selected-official-comparison').textContent =
    `공식 세포밀도 기준 비교 · ${compareOfficialThreshold(area.cellDensity)}`;

  riskGauge.style.setProperty('--risk-color', riskColor);
  riskGauge.style.setProperty('--risk-angle', `${area.riskScore * 3.6}deg`);
  dataBadge.textContent =
    area.dataStatus.measurements === 'hybrid'
      ? '공식 관측·예시 혼합 데이터'
      : '시연모드 · 예시 데이터';
  dataBadge.dataset.mode = area.dataStatus.measurements;

  metrics.innerHTML = detailMetricDefinitions
    .map((metric) => {
      const source = getFieldSource(area, metric.key);
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
            ${metric.format(area[metric.key])}
            <small class="text-[7px] font-medium text-slate-400">${metric.unit}</small>
          </strong>
        </div>
      `;
    })
    .join('');

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function createChartPoints(values, minimum, maximum) {
  const chartWidth =
    CHART.width - CHART.padding.left - CHART.padding.right;
  const chartHeight =
    CHART.height - CHART.padding.top - CHART.padding.bottom;

  return values.map((value, index) => ({
    x:
      CHART.padding.left +
      (index / Math.max(1, values.length - 1)) * chartWidth,
    y:
      CHART.padding.top +
      ((maximum - value) / Math.max(1, maximum - minimum)) * chartHeight,
  }));
}

function pointsToAttribute(points) {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function renderTrendChart(area) {
  const areaIndex = activeAreas.findIndex((item) => item.id === area.id);
  const trend = createDemoHourlyTrend(area, Math.max(0, areaIndex));
  const chartElement = document.querySelector('#trend-chart');
  if (!trend?.length || !chartElement) return;

  const densityValues = trend.map((point) => point.cellDensity);
  const temperatureValues = trend.map((point) => point.waterTemperature);
  const densityMaximum = Math.max(20, ...densityValues) * 1.15;
  const temperatureMinimum = Math.floor(
    Math.min(...temperatureValues) - 0.5,
  );
  const temperatureMaximum = Math.ceil(
    Math.max(...temperatureValues) + 0.5,
  );
  const densityPoints = createChartPoints(
    densityValues,
    0,
    densityMaximum,
  );
  const temperaturePoints = createChartPoints(
    temperatureValues,
    temperatureMinimum,
    temperatureMaximum,
  );
  const chartBottom = CHART.height - CHART.padding.bottom;
  const chartRight = CHART.width - CHART.padding.right;
  const latestDensityPoint = densityPoints.at(-1);
  const latestTemperaturePoint = temperaturePoints.at(-1);

  document.querySelector('#trend-title').textContent =
    `${area.name} 세포밀도·수온 변화`;
  document.querySelector('#trend-current-density').textContent =
    numberFormatter.format(area.cellDensity);
  document.querySelector('#trend-current-temperature').textContent =
    area.waterTemperature.toFixed(1);
  document.querySelector('#trend-growth').textContent =
    `${area.recentCellGrowth > 0 ? '+' : ''}${area.recentCellGrowth}%`;
  document.querySelector('#trend-growth').style.color =
    area.recentCellGrowth >= 20 ? '#dc2626' : '#0f766e';
  chartElement.setAttribute(
    'aria-label',
    `${area.name} 해역의 24시간 세포밀도와 수온 변화 시연 그래프`,
  );

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y =
      CHART.padding.top +
      ratio * (CHART.height - CHART.padding.top - CHART.padding.bottom);
    const densityLabel = Math.round(densityMaximum * (1 - ratio));
    const temperatureLabel = (
      temperatureMaximum -
      (temperatureMaximum - temperatureMinimum) * ratio
    ).toFixed(1);

    return `
      <line
        class="chart-grid-line"
        x1="${CHART.padding.left}"
        x2="${chartRight}"
        y1="${y}"
        y2="${y}"
      ></line>
      <text
        class="chart-axis-label"
        x="${CHART.padding.left - 9}"
        y="${y + 3}"
        text-anchor="end"
      >${densityLabel}</text>
      <text
        class="chart-axis-label"
        x="${chartRight + 9}"
        y="${y + 3}"
        text-anchor="start"
      >${temperatureLabel}</text>
    `;
  }).join('');

  const timeLabels = trend
    .map((point, index) => {
      if (index % 4 !== 0 && index !== trend.length - 1) return '';
      const x = densityPoints[index].x;
      return `
        <text
          class="chart-time-label"
          x="${x}"
          y="${CHART.height - 13}"
          text-anchor="middle"
        >${point.time}</text>
      `;
    })
    .join('');

  chartElement.innerHTML = `
    <svg
      viewBox="0 0 ${CHART.width} ${CHART.height}"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="density-gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#ef4444" stop-opacity="0.25"></stop>
          <stop offset="100%" stop-color="#ef4444" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${gridLines}
      <text
        class="chart-axis-label chart-axis-title"
        x="${CHART.padding.left}"
        y="15"
        fill="#dc2626"
      >cells/mL</text>
      <text
        class="chart-axis-label chart-axis-title"
        x="${chartRight}"
        y="15"
        fill="#0284c7"
        text-anchor="end"
      >수온 ℃</text>
      <polygon
        class="chart-density-area"
        points="${CHART.padding.left},${chartBottom} ${pointsToAttribute(densityPoints)} ${chartRight},${chartBottom}"
      ></polygon>
      <polyline
        class="chart-density-line"
        points="${pointsToAttribute(densityPoints)}"
      ></polyline>
      <polyline
        class="chart-temperature-line"
        points="${pointsToAttribute(temperaturePoints)}"
      ></polyline>
      <circle
        class="chart-latest-point"
        cx="${latestDensityPoint.x}"
        cy="${latestDensityPoint.y}"
        r="4"
        fill="#ef4444"
      ></circle>
      <circle
        class="chart-latest-point"
        cx="${latestTemperaturePoint.x}"
        cy="${latestTemperaturePoint.y}"
        r="4"
        fill="#0ea5e9"
      ></circle>
      ${timeLabels}
    </svg>
  `;
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
              ${dashboardState.mode === 'hybrid' ? '혼합 데이터' : '예시 데이터'}
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
      const color = getRiskColor(area.riskScore);
      const officialComparison = compareOfficialThreshold(area.cellDensity);
      const dataModeLabel =
        area.dataStatus.measurements === 'hybrid'
          ? '공식 관측·예시 혼합'
          : '시연모드 · 예시 데이터';

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
              <strong class="block text-2xl font-extrabold ${riskTextClass(area.riskScore)}">
                ${area.riskScore}
              </strong>
              <span class="text-[9px] font-bold" style="color:${color}">
                자체 ${area.riskLevel}
              </span>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-3 gap-2 border-y border-slate-100 py-3">
            <div>
              <span class="block text-[8px] text-slate-400">세포밀도</span>
              <strong class="mt-1 block text-xs text-slate-800">
                ${numberFormatter.format(area.cellDensity)}
                <small class="font-normal text-slate-400">cells/mL</small>
              </strong>
            </div>
            <div>
              <span class="block text-[8px] text-slate-400">수온</span>
              <strong class="mt-1 block text-xs text-slate-800">
                ${area.waterTemperature.toFixed(1)}℃
              </strong>
            </div>
            <div>
              <span class="block text-[8px] text-slate-400">Chl-a</span>
              <strong class="mt-1 block text-xs text-slate-800">
                ${area.chlorophyllA.toFixed(1)}
                <small class="font-normal text-slate-400">µg/L</small>
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
          <span class="mt-3 inline-flex items-center gap-1 text-[9px] font-bold text-tide-700">
            지도·상세정보에서 보기
            <i data-lucide="arrow-up-right" class="h-3 w-3"></i>
          </span>
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

function renderWeights() {
  const container = document.querySelector('#weight-grid');

  container.innerHTML = Object.entries(RISK_WEIGHTS)
    .map(
      ([key, weight]) => `
        <div>
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-700">${weightLabels[key]}</span>
            <strong class="text-tide-700">${Math.round(weight * 100)}%</strong>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              data-risk-fill
              class="h-full rounded-full bg-tide-600"
              style="width:${weight * 100}%"
            ></div>
          </div>
        </div>
      `,
    )
    .join('');
}

async function initializeApp() {
  initializeMobileNavigation();
  initializeMetricHelp();
  renderToday();
  renderWeights();

  try {
    dashboardState = await loadPublicMarineData(demoMarineAreas);
  } catch (error) {
    console.error('공공데이터 초기화에 실패해 시연모드로 전환합니다.', error);
    dashboardState = await loadPublicMarineData(demoMarineAreas, {
      config: {
        NIFS_API_KEY: '',
        DATA_GO_KR_KEY: '',
        KHOA_TIDE_OBSERVATION_CODE: '',
        KHOA_BUOY_OBSERVATION_CODE: '',
      },
    });
    dashboardState.warnings.push(
      '데이터 처리 중 예기치 않은 오류가 발생해 전체 시연모드로 전환했습니다.',
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
  selectArea(selectedAreaId);
  initializeMonthlyRiskCalendar({
    officialObservations: dashboardState.officialObservations,
  });

  // 동적으로 추가된 아이콘까지 한 번에 활성화합니다.
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

initializeApp();
