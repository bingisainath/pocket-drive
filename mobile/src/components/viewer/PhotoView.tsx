import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { authHeaders, urls } from '../../api/drive';
import { wantsPreview } from '../../shared/lib/entries';
import type { Entry } from '../../shared/types';

const MAX_SCALE = 4;

/** Full-screen photo with pinch, pan and double-tap zoom. Shows the screen-sized /preview (or the
 *  original for small images), Bearer-authorised and disk-cached by FastImage. */
export function PhotoView({ entry }: { entry: Entry }) {
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.8), MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value <= 1) reset();
      else savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) reset();
      else {
        scale.value = withTiming(2);
        savedScale.value = 2;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const source = { uri: (wantsPreview(entry) ? urls.preview(entry) : urls.raw(entry)), headers: authHeaders() };

  return (
    <View style={styles.container}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, style]}>
          <Image
            source={source}
            resizeMode="contain"
            style={StyleSheet.absoluteFill}
            onLoadEnd={() => setLoading(false)}
          />
        </Animated.View>
      </GestureDetector>
      {loading && <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color="#fff" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
});
