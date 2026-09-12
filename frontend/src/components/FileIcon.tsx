import {
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  File as FileGeneric,
  Film,
  Folder,
  Image as ImageIcon,
  Music,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { urls } from '../api';
import { hasThumbnail, kindOf, type Kind } from '../lib/entries';
import type { Entry } from '../types';

const ICONS: Record<Kind, { Icon: LucideIcon; color: string }> = {
  folder: { Icon: Folder, color: 'text-amber-500 fill-amber-400/30' },
  image: { Icon: ImageIcon, color: 'text-rose-500' },
  video: { Icon: Film, color: 'text-violet-500' },
  audio: { Icon: Music, color: 'text-pink-500' },
  pdf: { Icon: FileText, color: 'text-red-500' },
  text: { Icon: FileText, color: 'text-slate-500' },
  code: { Icon: FileCode, color: 'text-emerald-600' },
  archive: { Icon: FileArchive, color: 'text-amber-600' },
  doc: { Icon: FileText, color: 'text-blue-600' },
  sheet: { Icon: FileSpreadsheet, color: 'text-green-600' },
  slides: { Icon: Presentation, color: 'text-orange-500' },
  other: { Icon: FileGeneric, color: 'text-slate-400' },
};

export function FileIcon({
  entry,
  className = 'size-6',
}: {
  entry: Pick<Entry, 'name' | 'mime' | 'isDir'>;
  className?: string;
}) {
  const { Icon, color } = ICONS[kindOf(entry)];
  return <Icon className={`${className} ${color}`} strokeWidth={1.75} aria-hidden="true" />;
}

/** Server-rendered thumbnail when there is one, otherwise the type icon. */
export function Thumb({ entry, iconClassName }: { entry: Entry; iconClassName?: string }) {
  const [failed, setFailed] = useState(false);
  if (!hasThumbnail(entry) || failed) return <FileIcon entry={entry} className={iconClassName} />;
  return (
    <img
      src={urls.thumb(entry)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  );
}
