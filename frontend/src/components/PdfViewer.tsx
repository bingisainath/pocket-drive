// Lazy-loaded: pdf.js only downloads when a PDF is first opened. Needed because mobile browsers
// (Android Chrome in particular) won't render PDFs inline — they just download them.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner } from './ui';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PIXEL_RATIO = 2; // sharper than 1x, without blowing up memory on 3x phone screens

export default function PdfViewer({ url, fallback }: { url: string; fallback: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const root = container.current!;
    const task = getDocument({ url });
    let observer: IntersectionObserver | undefined;
    let cancelled = false;

    async function renderPage(doc: PDFDocumentProxy, slot: HTMLElement) {
      const page = await doc.getPage(Number(slot.dataset.page));
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = (slot.clientWidth / natural.width) * Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = 'block h-auto w-full';
      slot.style.aspectRatio = `${natural.width} / ${natural.height}`;
      slot.replaceChildren(canvas);
      await page.render({ canvas, viewport }).promise;
    }

    task.promise
      .then(async (doc) => {
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        // One placeholder per page (sized like page 1); pages render as they scroll into view.
        const slots = Array.from({ length: doc.numPages }, (_, i) => {
          const slot = document.createElement('div');
          slot.dataset.page = String(i + 1);
          slot.className = 'mx-auto mb-3 w-full max-w-3xl bg-white shadow-lg';
          slot.style.aspectRatio = `${first.width} / ${first.height}`;
          return slot;
        });
        root.replaceChildren(...slots);
        observer = new IntersectionObserver(
          (records) => {
            for (const record of records) {
              if (!record.isIntersecting) continue;
              observer!.unobserve(record.target);
              renderPage(doc, record.target as HTMLElement).catch(() => {});
            }
          },
          { root, rootMargin: '800px 0px' },
        );
        slots.forEach((slot) => observer!.observe(slot));
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));

    return () => {
      cancelled = true;
      observer?.disconnect();
      void task.destroy();
    };
  }, [url]);

  if (status === 'error') return <>{fallback}</>;
  return (
    <div className="relative h-full w-full self-stretch">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="size-8 text-white/60" />
        </div>
      )}
      <div ref={container} className="h-full overflow-y-auto overscroll-contain px-2 py-4 sm:px-6" />
    </div>
  );
}
