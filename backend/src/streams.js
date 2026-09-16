import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { joinRel, resolveInside } from './paths.js';

const execFileP = promisify(execFile);

// Phones record HEVC, which Chrome on Windows and Firefox often can't play; H.264 HLS plays everywhere.
const STREAMABLE = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-m4v',
  'video/3gpp',
  'video/x-msvideo',
  'video/mpeg',
]);
export const canStream = (mime) => STREAMABLE.has(mime);

const SEGMENT_SECONDS = 4;
const KEYFRAME_SECONDS = 2; // segments can only start on a keyframe
const MAX_FPS = 30; // 60 fps phone video is halved: half the work for the phone, same smoothness for most viewers
/** Files a player may fetch from a video's streaming folder. */
const STREAM_FILE = /^(master\.m3u8|(low|high)\/(index\.m3u8|seg_\d{3,6}\.ts))$/;

/**
 * Qualities to offer, by the picture's short side so portrait phone videos get the same treatment:
 * 480p for weak connections, plus 1080p (or the source's own size, if smaller) when there's more to
 * show. Bitrates scale with the pixel count.
 */
export function planRenditions({ width, height }) {
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  const short = Math.min(width, height);
  const renditions = [{ name: 'low', shortSide: Math.min(480, even(short)), videoKbps: 1000, audioKbps: 96 }];
  if (short > 480) {
    const shortSide = Math.min(1080, even(short));
    renditions.push({ name: 'high', shortSide, videoKbps: Math.round(5000 * (shortSide / 1080) ** 2), audioKbps: 128 });
  }
  return renditions;
}

async function probe(ffprobe, src) {
  const { stdout } = await execFileP(
    ffprobe,
    ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate:stream_tags=rotate:stream_side_data=rotation:format=duration', '-of', 'json', src],
    { timeout: 60_000 },
  );
  const info = JSON.parse(stdout);
  const video = info.streams?.find((s) => s.codec_type === 'video');
  if (!video?.width || !video?.height) throw new Error('no video stream');
  const rotation = Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const sideways = Math.abs(rotation) % 180 === 90; // ffmpeg turns the picture upright while converting
  const [num, den] = String(video.avg_frame_rate ?? '0/0').split('/').map(Number);
  return {
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    fps: den ? num / den : 0,
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
    duration: Number(info.format?.duration) || 0,
  };
}

function ffmpegArgs(src, dir, info, renditions) {
  const landscape = info.width >= info.height;
  const fps = !info.fps || info.fps > MAX_FPS + 0.5 ? `fps=${MAX_FPS},` : '';
  const outputs = renditions.map((_, i) => `[v${i}]`).join('');
  const scaled = renditions
    .map((r, i) => `[v${i}]scale=${landscape ? `-2:${r.shortSide}` : `${r.shortSide}:-2`}[out${i}]`)
    .join(';');
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', src];
  args.push('-filter_complex', `[0:v]${fps}split=${renditions.length}${outputs};${scaled}`);
  renditions.forEach((_, i) => {
    args.push('-map', `[out${i}]`);
    if (info.hasAudio) args.push('-map', '0:a:0');
  });
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p');
  args.push('-sc_threshold', '0', '-force_key_frames', `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`);
  renditions.forEach((r, i) => {
    args.push(`-b:v:${i}`, `${r.videoKbps}k`, `-maxrate:v:${i}`, `${Math.round(r.videoKbps * 1.2)}k`, `-bufsize:v:${i}`, `${r.videoKbps * 2}k`);
  });
  if (info.hasAudio) {
    args.push('-c:a', 'aac', '-ac', '2');
    renditions.forEach((r, i) => args.push(`-b:a:${i}`, `${r.audioKbps}k`));
  }
  const streamMap = renditions.map((r, i) => (info.hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`));
  args.push('-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments');
  args.push('-hls_segment_filename', path.join(dir, '%v', 'seg_%03d.ts'), '-master_pl_name', 'master.m3u8');
  args.push('-var_stream_map', streamMap.join(' '), path.join(dir, '%v', 'index.m3u8'));
  return args;
}

/** Run a command at low CPU priority, so browsing the drive stays responsive while it converts. */
function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    try {
      os.setPriority(child.pid, 10);
    } catch {}
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${code ?? signal}): ${stderr.trim().split('\n').pop()}`));
    });
  });
}

/**
 * Adaptive streaming versions of videos: HLS in two qualities (480p and up to 1080p, H.264/AAC in
 * 4-second segments) that the player switches between to suit the viewer's connection. Made by
 * ffmpeg one video at a time in the background, in `streamDir/<id>/`. Until one is ready, the
 * app plays the original file.
 */
export function createStreamer({ streamDir, storageDir, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', log = console }) {
  const failed = new Set(); // ids that couldn't be converted; not retried until restart
  const removed = new Set(); // ids deleted while possibly being converted
  const pending = new Map(); // id -> Promise<boolean>
  let queue = Promise.resolve();

  const dirOf = (id) => path.join(streamDir, String(id));
  const isReady = (id) => fsp.access(path.join(dirOf(id), 'master.m3u8')).then(() => true, () => false);

  async function convert(row) {
    const label = joinRel(row.parent_path, row.name);
    const src = resolveInside(storageDir, label);
    const work = `${dirOf(row.id)}.${crypto.randomUUID()}.tmp`;
    const started = Date.now();
    try {
      if (removed.has(row.id)) return false;
      const info = await probe(ffprobe, src);
      const renditions = planRenditions(info);
      await fsp.mkdir(work, { recursive: true });
      // Generous timeout: phone CPUs convert 4K at ~0.1x real time.
      await run(ffmpeg, ffmpegArgs(src, work, info, renditions), Math.max(30 * 60_000, info.duration * 120_000));
      if (removed.has(row.id)) throw new Error('deleted while converting');
      await fsp.rm(dirOf(row.id), { recursive: true, force: true });
      await fsp.rename(work, dirOf(row.id));
      const qualities = renditions.map((r) => `${r.shortSide}p`).join(' + ');
      log.log(`Streaming version of "${label}" ready (${qualities}) in ${Math.round((Date.now() - started) / 1000)}s`);
      return true;
    } catch (err) {
      failed.add(row.id);
      if (!removed.has(row.id)) log.warn(`No streaming version for "${label}": ${err.message}`);
      return false;
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }
  }

  /** Queue a video for conversion (once); resolves to whether its streaming version exists. */
  function enqueue(row) {
    if (!canStream(row.mime) || failed.has(row.id)) return Promise.resolve(false);
    let job = pending.get(row.id);
    if (!job) {
      job = queue = queue.then(async () => (await isReady(row.id)) || convert(row)).catch(() => false);
      job.finally(() => pending.delete(row.id));
      pending.set(row.id, job);
    }
    return job;
  }

  return {
    /** 'ready', 'processing' (conversion queued or running) or 'unavailable'. Queues it if needed. */
    async status(row) {
      if (!canStream(row.mime) || failed.has(row.id)) return 'unavailable';
      if (await isReady(row.id)) return 'ready';
      enqueue(row);
      return failed.has(row.id) ? 'unavailable' : 'processing';
    },
    /** Absolute path of a file inside a video's streaming folder, or null for anything else. */
    file: (row, rel) => (STREAM_FILE.test(rel) ? path.join(dirOf(row.id), rel) : null),
    warm(row) {
      enqueue(row).catch(() => {});
    },
    /** Convert every video still missing a streaming version; resolves to how many were made. */
    async backfill(rows) {
      const results = await Promise.all(rows.map((row) => isReady(row.id).then((ready) => !ready && enqueue(row))));
      return results.filter(Boolean).length;
    },
    async remove(ids) {
      for (const id of ids) removed.add(id);
      await Promise.all(ids.map((id) => fsp.rm(dirOf(id), { recursive: true, force: true })));
    },
  };
}
