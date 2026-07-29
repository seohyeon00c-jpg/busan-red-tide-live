/**
 * 브라우저는 API 키가 제거된 GitHub Actions 공개 캐시만 읽습니다.
 * 실제 인증키는 저장소의 GitHub Secrets에서 관리합니다.
 */
window.APP_CONFIG = Object.freeze({
  PUBLIC_DATA_CACHE_URL: './data/live-marine.json',
});
