import FastImage, { type FastImageProps, type Source } from '@d11/react-native-fast-image';
import { Film, ImageOff } from 'lucide-react-native';
import { memo, type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type ImageStyle, type LayoutChangeEvent, type StyleProp } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { authHeaders, urls } from '../../api/drive';
import { previewKind, wantsPreview } from '../../shared/lib/entries';
import type { Entry } from '../../shared/types';
import { AppText } from '../ui';
import { VideoView } from './VideoView';

// FastImage's bundled style types predate React Native 0.87's generated types; the props are the same.
const Photo = FastImage as unknown as ComponentType<Omit<FastImageProps, 'style'> & { style?: StyleProp<ImageStyle> }>;

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
/** Pages are committed after a drag of this fraction of the width, or a fast enough fling. */
const PAGE_THRESHOLD = 0.2;
const FLING_VELOCITY = 500;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
/** Leave the bottom of a video page to the player's own seek bar instead of paging. */
const VIDEO_CONTROLS_HEIGHT = 120;
const TIMING = { duration: 260, easing: Easing.out(Easing.cubic) };

// What the current single-finger drag is doing, decided when it starts.
const NONE = 0;
const PAGE = 1;
const DISMISS = 2;
const ZOOM_PAN = 3;

interface Props {
  items: Entry[];
  initialIndex: number;
  onIndexChange: (index: number) => void;
  /** Single tap on a photo: show/hide the viewer's chrome. */
  onTap: () => void;
  /** Swipe down on an unzoomed photo: close the viewer. */
  onDismiss: () => void;
}

const isPhoto = (e: Entry) => previewKind(e) === 'image';
const photoSource = (e: Entry, original: boolean): Source => ({
  uri: !original && wantsPreview(e) ? urls.preview(e) : urls.raw(e),
  headers: authHeaders(),
  priority: FastImage.priority.high,
});

/**
 * Full-screen, swipeable media viewer: drag or fling sideways between photos and videos, pinch or
 * double-tap to zoom (focal point stays under your fingers), drag to pan a zoomed photo, and swipe
 * down to close. Everything runs on the UI thread with Reanimated, and only the current page and its
 * two neighbours are mounted; their photos are preloaded so the next one is already there.
 */
export function MediaPager({ items, initialIndex, onIndexChange, onTap, onDismiss }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [index, setIndex] = useState(initialIndex);
  const { width, height } = size;
  const last = items.length - 1;
  const video = !isPhoto(items[index]);

  // Pager position in pages (fractional while dragging); `current` mirrors `index` for worklets.
  const page = useSharedValue(initialIndex);
  const current = useSharedValue(initialIndex);
  const startPage = useSharedValue(initialIndex);
  const mode = useSharedValue(NONE);
  const dismissY = useSharedValue(0);

  // Zoom of the current photo, and the size it's drawn at (so panning stops at its edges).
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const contentW = useSharedValue(0);
  const contentH = useSharedValue(0);

  // Fitted ("contain") size of each photo we've loaded, by entry id.
  const fitted = useRef(new Map<number, { w: number; h: number }>());

  const applyContentSize = useCallback(
    (entry: Entry) => {
      const fit = fitted.current.get(entry.id);
      contentW.value = fit?.w ?? width;
      contentH.value = fit?.h ?? height;
    },
    [contentW, contentH, width, height],
  );

  const onPhotoLoad = useCallback(
    (entry: Entry, naturalW: number, naturalH: number) => {
      if (!width || !height || !naturalW || !naturalH) return;
      const k = Math.min(width / naturalW, height / naturalH);
      fitted.current.set(entry.id, { w: naturalW * k, h: naturalH * k });
      if (entry.id === items[index]?.id) applyContentSize(entry);
    },
    [width, height, items, index, applyContentSize],
  );

  const changeIndex = useCallback(
    (next: number) => {
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
      savedScale.value = 1;
      savedTx.value = 0;
      savedTy.value = 0;
      setIndex(next);
    },
    [scale, tx, ty, savedScale, savedTx, savedTy],
  );

  useEffect(() => {
    onIndexChange(index);
    applyContentSize(items[index]);
    // Warm the cache for the neighbours so the next swipe shows a finished photo, not a spinner.
    const around = [items[index + 1], items[index - 1], items[index + 2]].filter((e): e is Entry => !!e && isPhoto(e));
    if (around.length) FastImage.preload(around.map((e) => photoSource(e, false)));
  }, [index, items, onIndexChange, applyContentSize]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== width || h !== height) {
      fitted.current.clear(); // fitted sizes depend on the viewport (e.g. after a rotation)
      setSize({ width: w, height: h });
    }
  };

  const pan = Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-12, 12])
    .activeOffsetY([-12, 12])
    .hitSlop(video ? { bottom: -VIDEO_CONTROLS_HEIGHT } : undefined)
    .onStart((e) => {
      startPage.value = page.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      if (scale.value > 1.01) mode.value = ZOOM_PAN;
      else if (Math.abs(e.translationY) > Math.abs(e.translationX)) mode.value = e.translationY > 0 ? DISMISS : NONE;
      else mode.value = PAGE;
    })
    .onUpdate((e) => {
      if (mode.value === PAGE) {
        let p = startPage.value - e.translationX / width;
        // Rubber-band past the first and last item.
        if (p < 0) p *= 0.3;
        else if (p > last) p = last + (p - last) * 0.3;
        page.value = p;
      } else if (mode.value === ZOOM_PAN) {
        const maxX = Math.max(0, (contentW.value * scale.value - width) / 2);
        const maxY = Math.max(0, (contentH.value * scale.value - height) / 2);
        tx.value = Math.min(maxX, Math.max(-maxX, savedTx.value + e.translationX));
        ty.value = Math.min(maxY, Math.max(-maxY, savedTy.value + e.translationY));
      } else if (mode.value === DISMISS) {
        dismissY.value = Math.max(0, e.translationY);
      }
    })
    .onEnd((e) => {
      if (mode.value === PAGE) {
        const base = current.value;
        const moved = page.value - base; // > 0: towards the next item
        let target = base;
        if (moved > PAGE_THRESHOLD || (moved > 0 && -e.velocityX > FLING_VELOCITY)) target = base + 1;
        else if (moved < -PAGE_THRESHOLD || (moved < 0 && e.velocityX > FLING_VELOCITY)) target = base - 1;
        target = Math.min(last, Math.max(0, target));
        if (target !== base) {
          current.value = target;
          scheduleOnRN(changeIndex, target); // mounts the new neighbour while the page settles
        }
        page.value = withTiming(target, TIMING);
      } else if (mode.value === ZOOM_PAN) {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      } else if (mode.value === DISMISS) {
        if (dismissY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) scheduleOnRN(onDismiss);
        else dismissY.value = withTiming(0, TIMING);
      }
      mode.value = NONE;
    });

  const pinch = Gesture.Pinch()
    .enabled(!video)
    .onStart((e) => {
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      focalX.value = e.focalX - width / 2;
      focalY.value = e.focalY - height / 2;
    })
    .onUpdate((e) => {
      const s = Math.min(MAX_SCALE, Math.max(0.85, savedScale.value * e.scale));
      const k = s / savedScale.value;
      // Keep the point under the fingers where it is.
      scale.value = s;
      tx.value = focalX.value - k * (focalX.value - savedTx.value);
      ty.value = focalY.value - k * (focalY.value - savedTy.value);
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withTiming(1, TIMING);
        tx.value = withTiming(0, TIMING);
        ty.value = withTiming(0, TIMING);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        return;
      }
      const maxX = Math.max(0, (contentW.value * scale.value - width) / 2);
      const maxY = Math.max(0, (contentH.value * scale.value - height) / 2);
      const x = Math.min(maxX, Math.max(-maxX, tx.value));
      const y = Math.min(maxY, Math.max(-maxY, ty.value));
      tx.value = withTiming(x, TIMING);
      ty.value = withTiming(y, TIMING);
      savedScale.value = scale.value;
      savedTx.value = x;
      savedTy.value = y;
    });

  const doubleTap = Gesture.Tap()
    .enabled(!video)
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e) => {
      if (scale.value > 1.01) {
        scale.value = withTiming(1, TIMING);
        tx.value = withTiming(0, TIMING);
        ty.value = withTiming(0, TIMING);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        return;
      }
      const s = DOUBLE_TAP_SCALE;
      const maxX = Math.max(0, (contentW.value * s - width) / 2);
      const maxY = Math.max(0, (contentH.value * s - height) / 2);
      // Zoom in on the tapped point.
      const x = Math.min(maxX, Math.max(-maxX, (e.x - width / 2) * (1 - s)));
      const y = Math.min(maxY, Math.max(-maxY, (e.y - height / 2) * (1 - s)));
      scale.value = withTiming(s, TIMING);
      tx.value = withTiming(x, TIMING);
      ty.value = withTiming(y, TIMING);
      savedScale.value = s;
      savedTx.value = x;
      savedTy.value = y;
    });

  const singleTap = Gesture.Tap()
    .enabled(!video) // a video's own controls handle taps
    .maxDuration(250)
    .onEnd(() => {
      scheduleOnRN(onTap);
    });

  const gesture = Gesture.Simultaneous(pan, pinch, Gesture.Exclusive(doubleTap, singleTap));

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -page.value * width }, { translateY: dismissY.value }],
  }));
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(dismissY.value / 400, 0.7) }));

  const visible = [index - 1, index, index + 1].filter((i) => i >= 0 && i <= last);

  return (
    <View style={styles.root} onLayout={onLayout}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      {width > 0 && (
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill}>
            <Animated.View style={[StyleSheet.absoluteFill, trackStyle]}>
              {visible.map((i) => (
                <View key={items[i].id} style={[styles.page, { left: i * width, width, height }]}>
                  <Animated.View style={[styles.fill, i === index && zoomStyle]}>
                    <MediaPage entry={items[i]} active={i === index} width={width} height={height} onPhotoLoad={onPhotoLoad} />
                  </Animated.View>
                </View>
              ))}
            </Animated.View>
          </View>
        </GestureDetector>
      )}
    </View>
  );
}

interface PageProps {
  entry: Entry;
  active: boolean;
  width: number;
  height: number;
  onPhotoLoad: (entry: Entry, naturalW: number, naturalH: number) => void;
}

const MediaPage = memo(function MediaPageBase({ entry, active, width, height, onPhotoLoad }: PageProps) {
  if (isPhoto(entry)) return <PhotoPage entry={entry} width={width} height={height} onPhotoLoad={onPhotoLoad} />;
  // Only the current page plays; neighbours show a placeholder so swiping away stops playback.
  if (active) return <VideoView entry={entry} />;
  return (
    <View style={styles.center}>
      <Film size={56} color="#ffffff66" strokeWidth={1.5} />
    </View>
  );
});

function PhotoPage({ entry, width, height, onPhotoLoad }: Omit<PageProps, 'active'>) {
  // A just-uploaded photo may not have its preview yet (it's made in the background): fall back to
  // the original, and only give up if that fails too.
  const [original, setOriginal] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const source = useMemo(() => photoSource(entry, original), [entry, original]);

  if (failed) {
    return (
      <View style={styles.center}>
        <ImageOff size={48} color="#ffffff99" strokeWidth={1.5} />
        <AppText variant="caption" style={styles.errorText}>
          Couldn’t load this photo
        </AppText>
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      <Photo
        source={source}
        style={StyleSheet.absoluteFill}
        resizeMode={FastImage.resizeMode.contain}
        onLoad={(e) => {
          setLoading(false);
          onPhotoLoad(entry, e.nativeEvent.width, e.nativeEvent.height);
        }}
        onError={() => {
          if (!original && wantsPreview(entry)) setOriginal(true);
          else setFailed(true);
        }}
      />
      {loading && <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color="#fff" />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  backdrop: { backgroundColor: '#000' },
  page: { position: 'absolute', top: 0, overflow: 'hidden' },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { color: '#ffffffcc' },
});
