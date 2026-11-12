import { Text } from "../../../shared/components/themed-text";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";

type Series = { label: string; color: string; values: number[] };

const WIDTH = 320;
const HEIGHT = 128;
const PAD = 10;

function sampled(values: number[]) {
  if (values.length <= 48) return values;
  const step = (values.length - 1) / 47;
  return Array.from({ length: 48 }, (_, index) => values[Math.round(index * step)]);
}

function pointsFor(values: number[]) {
  const data = sampled(values);
  if (!data.length) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(max - min, Math.abs(max) * 0.05, 1);
  return data.map((value, index) => {
    const x = PAD + (index / Math.max(data.length - 1, 1)) * (WIDTH - PAD * 2);
    const y = HEIGHT - PAD - ((value - min) / range) * (HEIGHT - PAD * 2);
    return `${x},${y}`;
  }).join(" ");
}

export function SensorTrendChart({ series, emptyText }: { series: Series[]; emptyText: string }) {
  const hasData = series.some((item) => item.values.length > 1);
  return <View>
    <View style={styles.legend}>{series.map((item) => <View key={item.label} style={styles.legendItem}><View style={[styles.dot, { backgroundColor: item.color }]} /><Text style={styles.legendText}>{item.label}</Text></View>)}</View>
    {hasData ? <View style={styles.chart} accessibilityLabel="Sensor trend chart">
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {[0.25, 0.5, 0.75].map((position) => <Line key={position} x1={PAD} x2={WIDTH - PAD} y1={HEIGHT * position} y2={HEIGHT * position} stroke={colors.border} strokeWidth="1" />)}
        {series.map((item) => <Polyline key={item.label} points={pointsFor(item.values)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}
      </Svg>
    </View> : <View style={styles.empty}><Text style={styles.emptyText}>{emptyText}</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3], marginBottom: spacing[2] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.semibold },
  chart: { overflow: "hidden", borderRadius: spacing[3], backgroundColor: colors.surfaceMuted },
  empty: { height: HEIGHT, alignItems: "center", justifyContent: "center", borderRadius: spacing[3], backgroundColor: colors.surfaceMuted },
  emptyText: { color: colors.textSubtle, fontSize: typography.mobile.size.caption, textAlign: "center" },
});
