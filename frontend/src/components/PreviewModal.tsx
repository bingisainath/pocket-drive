import { ChevronLeft, ChevronRight, Download, Trash2, X } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { urls } from '../api';
import { useOverlay } from '../hooks/useOverlay';
import { hasThumbnail, previewKind, wantsPreview } from '../lib/entries';
import { formatBytes, formatDateTime } from '../lib/format';
import type { Entry } from '../types';
import { FileIcon } from './FileIcon';
import { Spinner } from './ui';

const PdfViewer = lazy(() => import('./PdfViewer'));

interface Props {
  entry: Entry;
  /** Files in the current listing, for prev/next. */
  siblings: Entry[];
  onClose: () => void;
  onNavigate: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}

const darkBtn =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 active:bg-white/20';

export function PreviewModal({ entry, siblings, onClose, onNavigate, onDelete }: Props) {
  const isTop = useOverlay(onClose);
  const index = siblings.findIndex((e) => e.id === entry.id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const kind = previewKind(entry);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTop() || (e.target as HTMLElement).closest?.('video, audio, input, textarea')) return;
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
      if (e.key === 'ArrowRight' && next) onNavigate(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onNavigate, isTop]);

  // Warm the cache for the next photo (its preview, not the multi-MB original) so swiping feels instant.
  useEffect(() => {
    if (next && previewKind(next) === 'image') new window.Image().src = imageSrc(next);
  }, [next]);

  // Horizontal swipe between photos (ignored while pinch-zoomed or for video/PDF, which need gestures).
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || kind !== 'image' || (window.visualViewport?.scale ?? 1) > 1.05) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - start.t > 700) return;
    if (dx < 0 && next) onNavigate(next);
    if (dx > 0 && prev) onNavigate(prev);
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={entry.name} className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-neutral-950 text-white">
      <header className="flex shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={onClose} aria-label="Close preview" className={darkBtn}>
          <X className="size-6" />
        </button>
        <div className="min-w-0 flex-1 px-1 py-2">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="truncate text-xs text-white/60">
            {formatBytes(entry.size)} · {formatDateTime(entry.createdAt)}
          </p>
        </div>
        <a href={urls.download(entry)} download aria-label="Download" className={darkBtn}>
          <Download className="size-5" />
        </a>
        {entry.canDelete && (
          <button type="button" onClick={() => onDelete(entry)} aria-label="Delete" className={darkBtn}>
            <Trash2 className="size-5" />
          </button>
        )}
      </header>

      {/* touch-action: we handle horizontal swipes, so the browser mustn't treat them as "go back". */}
      <div
        className="relative flex min-h-0 flex-1 touch-pan-y touch-pinch-zoom items-center justify-center"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <PreviewContent key={entry.id} entry={entry} />
        {prev && (
          <button
            type="button"
            onClick={() => onNavigate(prev)}
            aria-label="Previous file"
            className={`${darkBtn} absolute top-1/2 left-3 hidden -translate-y-1/2 bg-white/10 sm:flex`}
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {next && (
          <button
            type="button"
            onClick={() => onNavigate(next)}
            aria-label="Next file"
            className={`${darkBtn} absolute top-1/2 right-3 hidden -translate-y-1/2 bg-white/10 sm:flex`}
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      {index >= 0 && siblings.length > 1 && (
        <p className="shrink-0 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-xs text-white/50 tabular-nums">
          {index + 1} / {siblings.length}
        </p>
      )}
    </div>,
    document.body,
  );
}

function PreviewContent({ entry }: { entry: Entry }) {
  switch (previewKind(entry)) {
    case 'image':
      return <ImagePreview entry={entry} />;
    case 'video':
      return <VideoPreview entry={entry} />;
    case 'audio':
      return (
        <div className="flex flex-col items-center gap-8 p-6">
          <FileIcon entry={entry} className="size-24" />
          <audio src={urls.raw(entry)} controls autoPlay className="w-[min(90vw,28rem)]" />
        </div>
      );
    case 'pdf':
      return (
        <Suspense fallback={<Spinner className="size-8 text-white/60" />}>
          <PdfViewer url={urls.raw(entry)} fallback={<NoPreview entry={entry} reason="This PDF couldn’t be displayed." />} />
        </Suspense>
      );
    case 'text':
      return <TextPreview entry={entry} />;
    default:
      return <NoPreview entry={entry} />;
  }
}

/** Big photos open as a screen-sized preview; small ones (and GIF/SVG) as the original. */
const imageSrc = (entry: Entry) => (wantsPreview(entry) ? urls.preview(entry) : urls.raw(entry));
/** Pinch-zoom level past which the preview isn't sharp enough and the original is swapped in. */
const ZOOMED_SCALE = 1.05;

function ImagePreview({ entry }: { entry: Entry }) {
  const original = urls.raw(entry);
  const [src, setSrc] = useState(() => imageSrc(entry));
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  // Zooming into a preview: load the original in the background and swap it in once it has
  // arrived, so the photo never blanks out mid-gesture.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || src === original) return;
    let loader: HTMLImageElement | null = null;
    const onResize = () => {
      if (loader || viewport.scale <= ZOOMED_SCALE) return;
      loader = new window.Image();
      loader.onload = () => setSrc(original);
      loader.src = original;
    };
    onResize();
    viewport.addEventListener('resize', onResize);
    return () => {
      viewport.removeEventListener('resize', onResize);
      if (loader) loader.onload = null;
    };
  }, [src, original]);

  const onError = () => {
    // No preview (e.g. a HEIC the server can't decode): fall back to the original before giving up.
    if (src !== original) setSrc(original);
    else setState('error');
  };

  if (state === 'error') return <NoPreview entry={entry} reason="Your browser can’t display this image format." />;
  return (
    <>
      <img
        src={src}
        alt={entry.name}
        draggable={false}
        onLoad={() => setState('ready')}
        onError={onError}
        className={`relative z-[1] max-h-full max-w-full object-contain transition-opacity duration-200 select-none ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
      />
      {state === 'loading' && (
        <>
          {/* The grid thumbnail is already in the browser cache: show it blurred straight away, so the
              photo appears instantly while the sharp version downloads. (After the main image in the
              DOM, so tests and code that look for the photo find the real one.) */}
          {hasThumbnail(entry) && (
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
              <img src={urls.thumb(entry)} alt="" draggable={false} className="aspect-square max-h-full w-full max-w-full object-cover blur-[2px]" />
            </div>
          )}
          <Spinner className="absolute size-8 text-white/60" />
        </>
      )}
    </>
  );
}

/**
 * Plays the adaptive streaming version (HLS, 480p–1080p) when the server has made it: natively in
 * Safari, through hls.js elsewhere (loaded only when a video is opened). Until then — or if the
 * browser can't do HLS — it plays the original file.
 */
function VideoPreview({ entry }: { entry: Entry }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<'checking' | 'stream' | 'original'>('checking');
  const [preparing, setPreparing] = useState(false);
  const [unplayable, setUnplayable] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ctrl = new AbortController();
    let player: { destroy(): void } | null = null;
    const playOriginal = (streamComing: boolean) => {
      setPreparing(streamComing);
      setSource('original');
    };

    (async () => {
      const master = urls.stream(entry);
      const res = await fetch(master, { signal: ctrl.signal }).catch(() => null);
      if (ctrl.signal.aborted) return;
      if (!res?.ok) {
        const body = await res?.json().catch(() => null);
        return playOriginal(body?.status === 'processing');
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = master; // Safari and iOS play HLS themselves
        return setSource('stream');
      }
      const { default: Hls } = await import('hls.js/light');
      if (ctrl.signal.aborted) return;
      if (!Hls.isSupported()) return playOriginal(false);
      const hls = new Hls({ capLevelToPlayerSize: true });
      player = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        hls.destroy();
        player = null;
        playOriginal(false);
      });
      hls.loadSource(master);
      hls.attachMedia(video);
      setSource('stream');
    })();

    return () => {
      ctrl.abort();
      player?.destroy();
    };
  }, [entry]);

  if (unplayable) {
    return (
      <NoPreview
        entry={entry}
        reason={
          preparing
            ? 'Your browser can’t play this video’s format. A version that plays everywhere is being prepared — try again in a few minutes.'
            : 'Your browser can’t play this video.'
        }
      />
    );
  }
  return (
    <div className="flex max-h-full max-w-full flex-col items-center">
      {source === 'checking' && <Spinner className="absolute size-8 text-white/60" />}
      <video
        ref={videoRef}
        src={source === 'original' ? urls.raw(entry) : undefined}
        controls
        autoPlay
        playsInline
        onError={() => {
          if (source === 'original') setUnplayable(true);
          else if (source === 'stream') setSource('original'); // native HLS failed: fall back to the file
        }}
        onLoadedMetadata={(e) => {
          // A browser without HEVC support (Chrome on most PCs, Firefox) plays a phone video's sound
          // over a blank picture instead of failing: treat "loaded but no picture" as unplayable.
          if (source === 'original' && e.currentTarget.videoWidth === 0) {
            e.currentTarget.pause();
            setUnplayable(true);
          }
        }}
        className="max-h-full max-w-full min-h-0"
      />
      {source === 'original' && preparing && (
        <p className="shrink-0 px-4 pt-2 text-center text-xs text-white/60">
          Playing the original. A faster streaming version is being prepared.
        </p>
      )}
    </div>
  );
}

function TextPreview({ entry }: { entry: Entry }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(urls.raw(entry), { signal: ctrl.signal })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(res.statusText))))
      .then(setText)
      .catch((err: Error) => err.name !== 'AbortError' && setFailed(true));
    return () => ctrl.abort();
  }, [entry]);

  if (failed) return <NoPreview entry={entry} reason="This file couldn’t be loaded." />;
  if (text === null) return <Spinner className="size-8 text-white/60" />;
  return (
    <pre className="h-full w-full max-w-4xl self-stretch overflow-auto bg-slate-900 p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-slate-100 sm:my-4 sm:rounded-xl">
      {text}
    </pre>
  );
}

function NoPreview({ entry, reason = 'No preview available for this file type.' }: { entry: Entry; reason?: string }) {
  return (
    <div className="flex flex-col items-center px-6 text-center">
      <div className="flex size-24 items-center justify-center rounded-3xl bg-white/10">
        <FileIcon entry={entry} className="size-12" />
      </div>
      <p className="mt-5 text-white/80">{reason}</p>
      <a
        href={urls.download(entry)}
        download
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-slate-900 transition hover:bg-white/90"
      >
        <Download className="size-4" />
        Download ({formatBytes(entry.size)})
      </a>
    </div>
  );
}
