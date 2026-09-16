// hls.js ships types for its full build only; the light build (no subtitles or alternate audio,
// which the drive's videos don't use) has the same API.
declare module 'hls.js/light' {
  export { default } from 'hls.js';
}
