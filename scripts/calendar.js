import {
  calculateDailyForecastRisk,
} from './risk.js?v=20260729-monthly-risk-v6';
import {
  fetchMonthlyMarineHistory,
} from './marineForecast.js?v=20260729-monthly-risk-v6';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

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
 * 날짜별 부산 6개 해역 최고 모델 위험지수를 포함한 월간 달력을 만듭니다.
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
          ? `${cell.dateKey}, 부산 최고 모델 위험지수 ${risk.score}점 ${risk.level}, ${risk.areaName} 해역, ${phase}`
          : `${cell.dateKey}, 모델 위험지수 자료 없음`
      }"
    >
      <span class="calendar-day">${cell.day}</span>
      ${
        risk
          ? `
            <strong>${risk.score}</strong>
            <span class="calendar-score-unit">점 · ${risk.level}</span>
            <small class="calendar-risk-area">${risk.areaName} 최고</small>
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

function calculateMonthlyHighestRisks(areas, history) {
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const highestByDate = new Map();

  history.areas.forEach((areaHistory) => {
    const area = areaById.get(areaHistory.areaId);
    if (!area) return;

    areaHistory.days.forEach((day) => {
      const risk = calculateDailyForecastRisk(area, day);
      if (!risk.available) return;

      const current = highestByDate.get(day.date);
      if (!current || risk.score > current.score) {
        highestByDate.set(day.date, {
          date: day.date,
          score: risk.score,
          level: risk.level,
          areaId: area.id,
          areaName: area.name,
          seaSurfaceTemperature: day.seaSurfaceTemperature,
          oceanCurrentVelocity: day.oceanCurrentVelocity,
          waveHeight: day.waveHeight,
        });
      }
    });
  });

  return [...highestByDate.values()];
}

/**
 * 과거 해양자료와 현재 해양예보를 동일 계산식에 넣은 월간 모델 달력입니다.
 */
export async function initializeMonthlyRiskCalendar(options = {}) {
  const today = options.today ?? new Date();
  const areas = options.areas ?? [];
  const calendar = buildCalendarMonth(
    today.getFullYear(),
    today.getMonth(),
    today,
  );
  const grid = document.querySelector('#calendar-grid');
  const title = document.querySelector('#calendar-title');
  const notice = document.querySelector('#calendar-notice');
  const status = document.querySelector('#calendar-status');

  if (!grid || !title || !notice || !status) return;

  title.textContent =
    `${calendar.year}년 ${calendar.monthIndex + 1}월 부산 적조 모델 위험지수`;
  notice.dataset.mode = 'model';
  notice.innerHTML = `
    <strong>동일 계산식 재계산</strong>
    <span>
      과거 날짜의 해수면수온·해류·파고 자료를 현재 모델에 넣어,
      부산 6개 해역 중 가장 높은 0~100 위험지수를 표시합니다.
      공식 적조관측이나 공식 특보가 아닙니다.
    </span>
  `;
  renderCalendarGrid(grid, calendar);
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
    const monthlyRisks = calculateMonthlyHighestRisks(areas, history);
    const updatedCalendar = buildCalendarMonth(
      today.getFullYear(),
      today.getMonth(),
      today,
      monthlyRisks,
    );
    renderCalendarGrid(grid, updatedCalendar);
    status.dataset.state = 'connected';
    status.innerHTML = `
      <strong>자료원: Open-Meteo Marine API</strong>
      <span>
        ${history.startDate}~${history.endDate} 해양 수치모델 자료 사용 ·
        Chl-a·염분·DO·세포밀도는 현재 연결 관측값을 기준으로 사용하며,
        없는 항목의 가중치는 0점으로 유지합니다.
      </span>
    `;
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
