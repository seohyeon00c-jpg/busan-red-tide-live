const MAP_IMAGE_URL = './assets/busan-district-map.png';

/**
 * 제공된 부산 행정구역 이미지 안에서 각 연안 해역을 표시할 상대 좌표입니다.
 * 퍼센트 좌표를 사용하므로 화면 크기가 바뀌어도 마커 위치가 함께 조절됩니다.
 */
const MAP_POSITIONS = Object.freeze({
  gijang: { left: 88, top: 25 },
  haeundae: { left: 82, top: 56 },
  gwangalli: { left: 71, top: 66 },
  yeongdo: { left: 54, top: 87 },
  dadaepo: { left: 37, top: 86 },
  gadeokdo: { left: 17, top: 82 },
});

function showMapError() {
  const errorElement = document.querySelector('#map-error');
  errorElement?.classList.remove('hidden');
  errorElement?.classList.add('grid');
}

function updateProviderLabel() {
  const label = document.querySelector('#map-provider-label');
  if (label) label.textContent = '부산 행정구역 이미지';
}

function createMapImage() {
  const image = document.createElement('img');
  image.className = 'simple-map-image';
  image.src = MAP_IMAGE_URL;
  image.alt = '부산광역시 구·군 행정구역 안내 지도';
  image.width = 1040;
  image.height = 714;
  image.loading = 'eager';
  image.decoding = 'async';
  image.addEventListener('error', showMapError, { once: true });
  return image;
}

function createMarker(area, onAreaSelect) {
  const position = MAP_POSITIONS[area.id];
  if (!position) return null;

  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'simple-map-marker';
  marker.dataset.areaId = area.id;
  marker.style.left = `${position.left}%`;
  marker.style.top = `${position.top}%`;
  marker.style.setProperty('--marker-color', '#94a3b8');
  marker.setAttribute(
    'aria-label',
    `${area.name} 해역, 오늘 모델 위험점수 불러오는 중`,
  );
  marker.setAttribute('aria-pressed', 'false');

  const label = document.createElement('span');
  label.className = 'simple-map-marker__label';
  label.textContent = area.name;

  const dot = document.createElement('span');
  dot.className = 'simple-map-marker__dot';
  dot.textContent = '–';
  dot.setAttribute('aria-hidden', 'true');

  marker.append(label, dot);
  marker.addEventListener('click', () => {
    onAreaSelect(area.id, { moveMap: false });
  });

  return marker;
}

/**
 * 제공 이미지를 배경으로 사용한 간편 부산 지도를 만들고 선택 상태를 연결합니다.
 */
export function initializeBusanMap(areas, onAreaSelect) {
  const mapElement = document.querySelector('#busan-map');

  if (!mapElement) {
    showMapError();
    return {
      selectArea: () => {},
      updateRiskScore: () => {},
    };
  }

  mapElement.replaceChildren();
  mapElement.append(createMapImage());
  updateProviderLabel();

  const markers = new Map();
  let selectedAreaId = areas[0]?.id;

  areas.forEach((area) => {
    const marker = createMarker(area, onAreaSelect);
    if (!marker) return;
    mapElement.append(marker);
    markers.set(area.id, marker);
  });

  function updateSelectedMarker(areaId) {
    selectedAreaId = areaId;
    markers.forEach((marker, markerAreaId) => {
      const selected = markerAreaId === selectedAreaId;
      marker.classList.toggle('is-selected', selected);
      marker.setAttribute('aria-pressed', String(selected));
    });
  }

  if (selectedAreaId) updateSelectedMarker(selectedAreaId);

  return {
    selectArea(areaId) {
      if (!markers.has(areaId)) return;
      updateSelectedMarker(areaId);
    },
    updateRiskScore(areaId, risk) {
      const marker = markers.get(areaId);
      const area = areas.find((candidate) => candidate.id === areaId);
      if (!marker || !area) return;

      const dot = marker.querySelector('.simple-map-marker__dot');
      if (!risk || !Number.isFinite(risk.score)) {
        if (dot) dot.textContent = '–';
        marker.style.setProperty('--marker-color', '#94a3b8');
        marker.setAttribute(
          'aria-label',
          `${area.name} 해역, 오늘 모델 위험점수 자료 없음`,
        );
        marker.title = '최신 공개 데이터 또는 해양예보를 불러오지 못했습니다.';
        return;
      }

      if (dot) dot.textContent = String(risk.score);
      marker.style.setProperty('--marker-color', risk.color);
      marker.setAttribute(
        'aria-label',
        `${area.name} 해역, 오늘 모델 위험점수 ${risk.score}점 ${risk.level}`,
      );
      marker.title =
        `${area.name} · 오늘 모델 위험점수 ${risk.score}점 (${risk.level})\n` +
        '최신 공개 데이터와 해양 수치예보를 동일 계산식으로 결합';
    },
  };
}
