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
 * 공식 관측 기록만 포함한 월간 달력 셀을 만듭니다.
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

function createOfficialCell(cell) {
  const records = cell.officialRecords;
  const confirmed = records.length > 0;
  const densities = records
    .map((item) => item.maxCellDensity)
    .filter(Number.isFinite);
  const maxDensity = densities.length > 0 ? Math.max(...densities) : null;

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
              ${maxDensity !== null ? `<small>${maxDensity.toLocaleString('ko-KR')} cells/mL</small>` : ''}
            </span>
          `
          : ''
      }
      ${cell.isToday ? '<span class="calendar-today-label">오늘</span>' : ''}
    </div>
  `;
}

/**
 * 현재 월의 공식 적조 관측 달력만 표시합니다.
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

  if (!grid || !title || !notice || !noOfficialRecords) return;

  title.textContent = `${calendar.year}년 ${calendar.monthIndex + 1}월 공식 적조 관측`;
  notice.dataset.mode = 'official';
  notice.innerHTML = `
    <strong>공식 관측 기록만 표시</strong>
    <span>국립수산과학원 자료에서 적조가 확인된 날짜만 색칠하며, 기록이 없으면 비워 둡니다.</span>
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
      return createOfficialCell(cell);
    }),
  ].join('');

  const officialCount = officialObservations.filter(
    (item) => item.confirmed === true,
  ).length;
  noOfficialRecords.classList.toggle('hidden', officialCount > 0);

  if (window.lucide) {
    window.lucide.createIcons();
  }
}
