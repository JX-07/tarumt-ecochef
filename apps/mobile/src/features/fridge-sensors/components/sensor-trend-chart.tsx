import { Text } from "../../../shared/components/themed-text";
import { colors, spacing, typography } from "@ecochef/design-tokens";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { timePosition } from "./trend-geometry";

type Series = { label: string; color: string; values: number[]; unit?: string };
const WIDTH = 320;
const HEIGHT = 128;
const PAD = 10;

function sampleIndices(length: number) {
  if (length <= 48) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / 47;
  return Array.from({ length: 48 }, (_, index) => Math.round(index * step));
}

function coordinates(values: number[], xPositions: number[], indices: number[]) {
  const data = indices.map((index) => values[index]);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(max - min, Math.abs(max) * 0.05, 1);
  return data.map((value, index) => ({
    x: xPositions[index],
    y: HEIGHT - PAD - ((value - min) / range) * (HEIGHT - PAD * 2),
  }));
}

function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatValue(value: number, unit?: string) {
  return `${unit === "°C" ? value.toFixed(1) : Math.round(value)}${unit ?? ""}`;
}

export function SensorTrendChart({
  series,
  timestamps,
  windowStart,
  windowEnd,
  emptyText,
}: {
  series: Series[];
  timestamps: string[];
  windowStart: number;
  windowEnd: number;
  emptyText: string;
}) {
  const [width, setWidth] = useState(WIDTH);
  const [selectedTime, setSelectedTime] = useState<string>();
  const count = Math.min(timestamps.length, ...series.map((item) => item.values.length));
  const indices = sampleIndices(count);
  const xPositions = indices.map(
    (index) => PAD + timePosition(timestamps[index], windowStart, windowEnd) * (WIDTH - PAD * 2),
  );
  const selectedIndex = selectedTime ? timestamps.indexOf(selectedTime) : -1;
  const selectedPoint = indices.indexOf(selectedIndex);
  const hasData = count > 1;

  return (
    <View>
      <View style={styles.legend}>
        {series.map((item) => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>
      {hasData ? (
        <>
          <Pressable
            style={styles.chart}
            accessibilityRole="button"
            accessibilityLabel="Sensor trend chart. Tap to inspect exact readings."
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            onPress={(event) => {
              const tapX = (event.nativeEvent.locationX / Math.max(width, 1)) * WIDTH;
              const point = xPositions.reduce(
                (closest, x, index) =>
                  Math.abs(x - tapX) < Math.abs(xPositions[closest] - tapX) ? index : closest,
                0,
              );
              setSelectedTime(timestamps[indices[point]]);
            }}
          >
            <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
              {[0.25, 0.5, 0.75].map((position) => (
                <Line
                  key={position}
                  x1={PAD}
                  x2={WIDTH - PAD}
                  y1={HEIGHT * position}
                  y2={HEIGHT * position}
                  stroke={colors.border}
                  strokeWidth="1"
                />
              ))}
              {series.map((item) => {
                const points = coordinates(item.values, xPositions, indices);
                return (
                  <Polyline
                    key={item.label}
                    points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}
              {selectedPoint >= 0 ? (
                <>
                  <Line
                    x1={xPositions[selectedPoint]}
                    x2={xPositions[selectedPoint]}
                    y1={0}
                    y2={HEIGHT}
                    stroke={colors.textMuted}
                    strokeDasharray="3 3"
                  />
                  {series.map((item) => {
                    const point = coordinates(item.values, xPositions, indices)[selectedPoint];
                    return (
                      <Circle
                        key={item.label}
                        cx={point.x}
                        cy={point.y}
                        r={4}
                        fill={item.color}
                        stroke={colors.surface}
                        strokeWidth={2}
                      />
                    );
                  })}
                </>
              ) : null}
            </Svg>
          </Pressable>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(new Date(windowStart).toISOString())}</Text>
            <Text style={styles.timeText}>{formatTime(new Date(windowEnd).toISOString())}</Text>
          </View>
          {selectedIndex >= 0 && selectedIndex < count ? (
            <View style={styles.selected}>
              <Text style={styles.selectedTime}>{formatTime(timestamps[selectedIndex])}</Text>
              <View style={styles.selectedValues}>
                {series.map((item) => (
                  <Text key={item.label} style={styles.selectedValue}>
                    {item.label}: {formatValue(item.values[selectedIndex], item.unit)}
                  </Text>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.hint}>Tap the line to see exact readings.</Text>
          )}
        </>
      ) : count === 1 ? (
        <View style={styles.selected}>
          <Text style={styles.selectedTime}>{formatTime(timestamps[0])}</Text>
          <View style={styles.selectedValues}>
            {series.map((item) => (
              <Text key={item.label} style={styles.selectedValue}>
                {item.label}: {formatValue(item.values[0], item.unit)}
              </Text>
            ))}
          </View>
          <Text style={styles.hint}>The trend appears after another reading arrives.</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3], marginBottom: spacing[2] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    color: colors.textMuted,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.semibold,
  },
  chart: { overflow: "hidden", borderRadius: spacing[3], backgroundColor: colors.surfaceMuted },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing[1] },
  timeText: { color: colors.textSubtle, fontSize: typography.mobile.rawSize.s10 },
  hint: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s10, marginTop: spacing[2] },
  selected: {
    marginTop: spacing[2],
    padding: spacing[3],
    borderRadius: spacing[2],
    backgroundColor: colors.primarySoft,
  },
  selectedTime: {
    color: colors.text,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
  },
  selectedValues: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[1],
  },
  selectedValue: { color: colors.text, fontSize: typography.mobile.rawSize.s11 },
  empty: {
    height: HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing[3],
    backgroundColor: colors.surfaceMuted,
  },
  emptyText: {
    color: colors.textSubtle,
    fontSize: typography.mobile.size.caption,
    textAlign: "center",
  },
});
