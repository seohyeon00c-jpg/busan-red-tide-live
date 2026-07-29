import {
  calculateDailyForecastRisk,
} from './risk.js?v=20260729-area-calendar-v7';
import {
  fetchMonthlyMarineHistory,
} from './marineForecast.js?v=20260729-area-calendar-v7';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const calendarState = {
  today: null,
  areas: [],
  history: null,
  selectedAreaId: null,
  onAreaSelect: null,
  grid: null,
  title: null,
  notice: null,
  status: null,
  areaTabs: null,
};

function toDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getRiskClass(score) {
  if (score >= 80) return 'risk-critical';
  if (score >= 60) return 'risk-warning';
  if (score >= 40) return 'risk-caution';
  if (score >= 20) return 'risk-interest';
  return 'risk-safe';
}

/**
 * 선택 해역의 날짜별 모델 위험지수를 포함한 월간 달력을 만듭니다.
 */
export function buildCalendarMonth(
  year,
  monthIndex,
  today = new Date(),
  monthlyRisks = [],
) {
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const todayKey = toDateKey(today);
  const riskByDate = new Map(
    monthlyRisks.map((risk) => [risk.date, risk]),
  );
  const cells = Array.from({ length: firstWeekday }, () => ({
    type: 'empty',
  }));

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthIndex, day);
    const dateKey = toDateKey(date);

    cells.push({
      type: 'day',
      day,
      dateKey,
      isToday: dateKey === todayKey,
      isPast: dateKey < todayKey,
      isFuture: dateKey > todayKey,
      risk: riskByDate.get(dateKey) ?? null,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ type: 'empty' });
  }

  return {
    year,
    monthIndex,
    weekdays: WEEKDAYS,
    cells,
  };
}

function createModelCell(cell) {
  const risk = cell.risk;
  const phase = cell.isPast
    ? '과거 재계산'
    : cell.isFuture
      ? '예측'
      : '오늘';
  const riskClass = risk ? getRiskClass(risk.score) : '';

  return `
    <div
      class="calendar-cell ${riskClass} ${cell.isToday ? 'today' : ''}"
      role="gridcell"
      aria-label="${
        risk
          ? `${cell.dateKey}, ${risk.areaName} 해역 모델 위험지수 ${risk.score}점 ${risk.level}, ${phase}`
          : `${cell.dateKey}, 모델 위험지수 자료 없음`
      }"
    >
      <span class="calendar-day">${cell.day}</span>
      ${
        risk
          ? `
            <strong>${risk.score}</strong>
            <span class="calendar-score-unit">점 · ${risk.level}</span>
            <small class="calendar-risk-area">${risk.areaName}</small>
            <small class="calendar-risk-phase">${phase}</small>
          `
          : '<span class="calendar-no-record">자료 없음</span>'
      }
      ${cell.isToday ? '<span class="calendar-today-label">오늘</span>' : ''}
    </div>
  `;
}

function renderCalendarGrid(grid, calendar) {
  grid.innerHTML = [
    ...calendar.weekdays.map(
      (weekday) =>
        `<div class="calendar-weekday" role="columnheader">${weekday}</div>`,
    ),
    ...calendar.cells.map((cell) => {
      if (cell.type === 'empty') {
        return '<div class="calendar-cell empty" aria-hidden="true"></div>';
      }
      return createModelCell(cell);
    }),
  ].join('');
}

function getCalendarDateRange(today) {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const forecastLimit = new Date(today);
  forecastLimit.setDate(forecastLimit.getDate() + 7);
  const end = forecastLimit < monthEnd ? forecastLimit : monthEnd;

  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
  };
}

function calculateMonthlyAreaRisks(area, history) {
  const areaHistory = history.areas.find(
    (candidate) => candidate.areaId === area.id,
  );
  if (!areaHistory) return [];

  return areaHistory.days
    .map((day) => {
      const risk = calculateDailyForecastRisk(area, day);
      if (!risk.available) return null;

      return {
        date: day.date,
        score: risk.score,
        level: risk.level,
        areaId: area.id,
        areaName: area.name,
        seaSurfaceTemperature: day.seaSurfaceTemperature,
        oceanCurrentVelocity: day.oceanCurrentVelocity,
        waveHeight: day.waveHeight,
      };
    })
    .filter(Boolean);
}

function getSelectedArea() {
  return calendarState.areas.find(
    (area) => area.id === calendarState.selectedAreaId,
  );
}

function renderAreaTabs() {
  const { areaTabs, areas, selectedAreaId, onAreaSelect } = calendarState;
  if (!areaTabs) return;

  areaTabs.innerHTML = areas
    .map(
      (area) => `
        <button
          type="button"
          class="calendar-area-button"
          data-calendar-area-id="${area.id}"
          aria-pressed="${area.id === selectedAreaId}"
        >
          ${area.name}
        </button>
      `,
    )
    .join('');

  areaTabs.querySelectorAll('[data-calendar-area-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const areaId = button.dataset.calendarAreaId;
      if (typeof onAreaSelect === 'function') {
        onAreaSelect(areaId, { moveMap: false });
      } else {
        selectMonthlyRiskCalendarArea(areaId);
      }
    });
  });
}

function renderSelectedAreaCalendar() {
  const {
    today,
    history,
    grid,
    title,
    notice,
    status,
  } = calendarState;
  const area = getSelectedArea();
  if (!area || !today || !grid || !title || !notice || !status) return;

  title.textContent =
    `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${area.name} 적조 모델 위험지수`;
  notice.dataset.mode = 'model';
  notice.innerHTML = `
    <strong>${area.name} 해역 선택</strong>
    <span>
      과거 날짜의 해수면수온·해류·파고 자료를 현재 모델에 넣어
      선택한 해역의 0~100 위험지수를 표시합니다.
      공식 적조관측이나 공식 특보가 아닙니다.
    </span>
  `;
  renderAreaTabs();

  const monthlyRisks = history
    ? calculateMonthlyAreaRisks(area, history)
    : [];
  const calendar = buildCalendarMonth(
    today.getFullYear(),
    today.getMonth(),
    today,
    monthlyRisks,
  );
  renderCalendarGrid(grid, calendar);

  if (!history) return;
  status.dataset.state = 'connected';
  status.innerHTML = `
    <strong>자료원: Open-Meteo Marine API · ${area.name}</strong>
    <span>
      ${history.startDate}~${history.endDate} 해양 수치모델 자료 사용 ·
      Chl-a·염분·DO·세포밀도는 현재 연결 관측값을 기준으로 사용하며,
      없는 항목의 가중치는 0점으로 유지합니다.
    </span>
  `;
}

/**
 * 지도·해역 카드 선택을 월간 위험지수 달력과 동기화합니다.
 */
export function selectMonthlyRiskCalendarArea(areaId) {
  if (!areaId) return;
  calendarState.selectedAreaId = areaId;
  renderSelectedAreaCalendar();
}

/**
 * 과거 해양자료와 현재 해양예보를 동일 계산식에 넣은 지역별 월간 달력입니다.
 */
export async function initializeMonthlyRiskCalendar(options = {}) {
  const today = options.today ?? new Date();
  const areas = options.areas ?? [];
  const grid = document.querySelector('#calendar-grid');
  const title = document.querySelector('#calendar-title');
  const notice = document.querySelector('#calendar-notice');
  const status = document.querySelector('#calendar-status');
  const areaTabs = document.querySelector('#calendar-area-tabs');

  if (!grid || !title || !notice || !status || !areaTabs) return;

  calendarState.today = today;
  calendarState.areas = areas;
  calendarState.history = null;
  calendarState.selectedAreaId =
    options.selectedAreaId ??
    calendarState.selectedAreaId ??
    areas[0]?.id;
  calendarState.onAreaSelect = options.onAreaSelect ?? null;
  calendarState.grid = grid;
  calendarState.title = title;
  calendarState.notice = notice;
  calendarState.status = status;
  calendarState.areaTabs = areaTabs;

  renderSelectedAreaCalendar();
  status.dataset.state = 'loading';
  status.textContent = '현재 월의 과거 해양자료를 불러오고 있습니다.';

  if (areas.length === 0) {
    status.dataset.state = 'error';
    status.textContent = '계산할 부산 해역 정보가 없습니다.';
    return;
  }

  const range = getCalendarDateRange(today);

  try {
    const history = await fetchMonthlyMarineHistory(areas, range);
    calendarState.history = history;
    renderSelectedAreaCalendar();
  } catch (error) {
    console.warn('월간 모델 위험지수를 계산하지 못했습니다.', error);
    status.dataset.state = 'error';
    status.textContent =
      '과거 해양자료를 불러오지 못해 임의 점수를 표시하지 않았습니다.';
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}
