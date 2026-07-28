/**
 * 실제 NIFS 자료가 연결되기 전에는 이 배열을 비워 둡니다.
 * 확인되지 않은 날짜를 공식 관측처럼 표시하지 않습니다.
 */
export const officialRedTideObservations = Object.freeze([]);

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function toDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * API 미연결 시 화면 구조를 확인하기 위한 결정론적 시연 점수입니다.
 */
export function getDemoModelRisk(date, today = new Date()) {
  const sameMonth =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth();

  if (!sameMonth || date > today || date.getDate() % 6 === 0) {
    return null;
  }

  const day = date.getDate();
  const seasonalRise = Math.min(27, day * 0.9);
  const oscillation = Math.sin(day * 0.74) * 13;

  return Math.round(
    Math.max(12, Math.min(91, 28 + seasonalRise + oscillation)),
  );
}

/**
 * 연도와 월을 받아 7열 달력에 필요한 빈칸까지 포함한 셀 배열을 만듭니다.
 */
export function buildCalendarMonth(
  year,
  monthIndex,
  today = new Date(),
  officialObservations = officialRedTideObservations,
) {
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const officialByDate = new Map();

  officialObservations
    .filter((item) => item.confirmed === true)
    .forEach((item) => {
      const records = officialByDate.get(item.date) ?? [];
      records.push(item);
      officialByDate.set(item.date, records);
    });

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
      isToday: dateKey === toDateKey(today),
      modelScore: getDemoModelRisk(date, today),
      officialRecords: officialByDate.get(dateKey) ?? [],
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

function getModelTone(score) {
  if (score === null) return 'none';
  if (score >= 80) return 'very-high';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function createModelCell(cell) {
  const scoreText =
    cell.modelScore === null
      ? '<small class="calendar-no-record">기록 없음</small>'
      : `<strong>${cell.modelScore}</strong><small class="calendar-score-unit">점</small>`;

  return `
    <div
      class="calendar-cell ${getModelTone(cell.modelScore)} ${cell.isToday ? 'today' : ''}"
      role="gridcell"
      aria-label="${cell.dateKey}${cell.modelScore === null ? ', 모델 기록 없음' : `, 시연 모델 위험점수 ${cell.modelScore}점`}"
    >
      <span class="calendar-day">${cell.day}</span>
      ${scoreText}
      ${cell.isToday ? '<span class="calendar-today-label">오늘</span>' : ''}
    </div>
  `;
}

function createOfficialCell(cell) {
  const records = cell.officialRecords;
  const confirmed = records.length > 0;
  const maxDensity = confirmed
    ? Math.max(...records.map((item) => item.maxCellDensity ?? 0))
    : 0;

  return `
    <div
      class="calendar-cell official ${confirmed ? 'confirmed' : ''} ${cell.isToday ? 'today' : ''}"
      role="gridcell"
      aria-label="${cell.dateKey}${confirmed ? `, 공식 적조 관측 ${records.length}건 확인` : ', 공식 관측 기록 없음'}"
    >
      <span class="calendar-day">${cell.day}</span>
      ${
        confirmed
          ? `
            <span class="official-calendar-mark">
              <i data-lucide="circle-check" class="h-4 w-4"></i>
              확인 ${records.length}건
              ${maxDensity > 0 ? `<small>${maxDensity.toLocaleString('ko-KR')} cells/mL</small>` : ''}
            </span>
          `
          : ''
      }
      ${cell.isToday ? '<span class="calendar-today-label">오늘</span>' : ''}
    </div>
  `;
}

/**
 * 월간 달력을 초기화하고 두 데이터 탭의 전환을 담당합니다.
 */
export function initializeMonthlyRiskCalendar(options = {}) {
  const today = options.today ?? new Date();
  const officialObservations =
    options.officialObservations ?? officialRedTideObservations;
  const calendar = buildCalendarMonth(
    today.getFullYear(),
    today.getMonth(),
    today,
    officialObservations,
  );
  const grid = document.querySelector('#calendar-grid');
  const title = document.querySelector('#calendar-title');
  const notice = document.querySelector('#calendar-notice');
  const noOfficialRecords = document.querySelector('#no-official-records');
  const modelTab = document.querySelector('#calendar-model-tab');
  const officialTab = document.querySelector('#calendar-official-tab');
  let activeTab = 'model';

  if (!grid || !title || !notice || !modelTab || !officialTab) return;

  title.textContent = `${calendar.year}년 ${calendar.monthIndex + 1}월 적조 달력`;

  function render() {
    modelTab.setAttribute('aria-selected', String(activeTab === 'model'));
    officialTab.setAttribute(
      'aria-selected',
      String(activeTab === 'official'),
    );
    modelTab.classList.toggle('active', activeTab === 'model');
    officialTab.classList.toggle('active', activeTab === 'official');

    notice.dataset.mode = activeTab;
    notice.innerHTML =
      activeTab === 'model'
        ? `
          <strong>시연모드 · 예시 데이터</strong>
          <span>부산 6개 해역의 일별 모델 최대 위험점수 예시이며 실제 관측이나 미래 예보가 아닙니다.</span>
        `
        : `
          <strong>공식 관측 기록</strong>
          <span>연결된 공식 자료에서 실제 적조가 확인된 날짜만 표시합니다. 기록이 없으면 색칠하지 않습니다.</span>
        `;

    grid.innerHTML = [
      ...calendar.weekdays.map(
        (weekday) =>
          `<div class="calendar-weekday" role="columnheader">${weekday}</div>`,
      ),
      ...calendar.cells.map((cell) => {
        if (cell.type === 'empty') {
          return '<div class="calendar-cell empty" aria-hidden="true"></div>';
        }
        return activeTab === 'model'
          ? createModelCell(cell)
          : createOfficialCell(cell);
      }),
    ].join('');

    const officialCount = officialObservations.filter(
      (item) => item.confirmed === true,
    ).length;
    noOfficialRecords.classList.toggle(
      'hidden',
      activeTab !== 'official' || officialCount > 0,
    );

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  modelTab.addEventListener('click', () => {
    activeTab = 'model';
    render();
  });

  officialTab.addEventListener('click', () => {
    activeTab = 'official';
    render();
  });

  render();
}
