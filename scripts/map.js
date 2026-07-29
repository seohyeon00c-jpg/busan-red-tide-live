import { getRiskColor } from './risk.js';

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
  marker.style.setProperty('--marker-color', getRiskColor(area.riskScore));
  marker.setAttribute('aria-label', `${area.name} 해역, 자체 위험지수 ${area.riskScore}점`);
  marker.setAttribute('aria-pressed', 'false');

  const label = document.createElement('span');
  label.className = 'simple-map-marker__label';
  label.textContent = area.name;

  const dot = document.createElement('span');
  dot.className = 'simple-map-marker__dot';
  dot.textContent = area.riskScore;
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
  };
}
