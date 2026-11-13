import { apiBaseUrl } from "../../../lib/api-url";
import { Text } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { router, useLocalSearchParams } from "expo-router";
import * as Speech from "expo-speech";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../auth/auth-provider";
import { createMobileApi } from "../../../lib/api";
import { AppMessageModal } from "../../../shared/components/app-message-modal";
import { goBackOrReplace } from "../../../shared/navigation";
import { markMealCooked } from "../../meal-planning/cooking-history";
import type { RecipeDetail } from "../types";

const GREEN = palette.c12ad55;
const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process;

type StepTimer = { key: string; label: string; duration: number };
type TimerState = StepTimer & {
  remaining: number;
  running: boolean;
  paused: boolean;
  endAt?: number;
  flags: number[];
};
type VoicePackage = typeof import("expo-speech-recognition");
type InventoryItem = {
  id: string;
  name: string;
  quantity: string;
  expiry_date: string;
  category?: string;
  source: "manual" | "scanned" | "shopping";
  icon?: string;
};
type InventoryList = { items: InventoryItem[] };
const ingredientKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/s$/, "");
function parsedQuantity(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  if (!match) return;
  const raw = (match[2] ?? "pcs").toLowerCase();
  const aliases: Record<string, string> = {
    piece: "pcs",
    pieces: "pcs",
    pc: "pcs",
    slice: "slices",
    gram: "g",
    grams: "g",
    kilogram: "kg",
    kilograms: "kg",
    liter: "l",
    liters: "l",
    litre: "l",
    litres: "l",
    milliliter: "ml",
    milliliters: "ml",
  };
  const unit = aliases[raw] ?? raw;
  const metric =
    unit === "kg"
      ? { unit: "g", factor: 1000 }
      : unit === "l"
        ? { unit: "ml", factor: 1000 }
        : { unit, factor: 1 };
  return {
    amount: Number(match[1]) * metric.factor,
    unit: metric.unit,
    displayUnit: unit,
    factor: metric.factor,
  };
}
const quantityText = (amount: number, unit: string, factor: number) =>
  `${Number((amount / factor).toFixed(2))} ${unit}`;

function extractTimers(instruction: string, stepIndex: number): StepTimer[] {
  const timers: StepTimer[] = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(instruction)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const seconds = Math.max(
      1,
      Math.round(amount * (unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1)),
    );
    timers.push({
      key: `${stepIndex}-${timers.length}`,
      label: `${match[1]} ${unit.startsWith("h") ? "hour" : unit.startsWith("m") ? "minute" : "second"}${amount === 1 ? "" : "s"}`,
      duration: seconds,
    });
  }
  return timers;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function createChimeBase64() {
  const sampleRate = 8000;
  const duration = 1.5;
  const count = Math.floor(sampleRate * duration);
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      bytes[offset + index] = value.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    const t = index / sampleRate;
    const envelope = Math.exp(-2.2 * t);
    const wave =
      (Math.sin(2 * Math.PI * 523.25 * t) +
        0.7 * Math.sin(2 * Math.PI * 659.25 * t) +
        0.45 * Math.sin(2 * Math.PI * 783.99 * t)) *
      0.18 *
      envelope;
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, wave)) * 32767, true);
  }
  let binary = "";
  for (let start = 0; start < bytes.length; start += 4096)
    binary += String.fromCharCode(...bytes.subarray(start, start + 4096));
  return globalThis.btoa(binary);
}

export function CookingModeScreen() {
  const {
    recipeId,
    plannedDate,
    deductIngredients: deductIngredientsParam,
  } = useLocalSearchParams<{
    recipeId: string;
    plannedDate?: string;
    deductIngredients?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useMemo(() => createMobileApi(apiBaseUrl, () => user?.getIdToken()), [user]);
  const [recipe, setRecipe] = useState<RecipeDetail>();
  const [error, setError] = useState<string>();
  const [step, setStep] = useState(0);
  const [timers, setTimers] = useState<Record<string, TimerState>>({});
  const [reading, setReading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string>();
  const [deductIngredients, setDeductIngredients] = useState<boolean | undefined>(
    deductIngredientsParam === "1" ? true : deductIngredientsParam === "0" ? false : undefined,
  );
  const [finishing, setFinishing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<{
    title: string;
    message: string;
  }>();
  const [chimeUri, setChimeUri] = useState<string>();
  const chimePlayer = useAudioPlayer(chimeUri);
  const notifiedRef = useRef(new Set<string>());
  const voicePackageRef = useRef<VoicePackage | undefined>(undefined);
  const voiceSubscriptionsRef = useRef<Array<{ remove: () => void }>>([]);
  const voiceWantedRef = useRef(false);
  const commandRef = useRef({ text: "", time: 0 });
  const stepRef = useRef(0);
  const instructionsRef = useRef<string[]>([]);
  const restartingRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    instructionsRef.current = recipe?.instructions ?? [];
  }, [recipe]);
  useEffect(() => {
    let active = true;
    if (!recipeId) return;
    setError(undefined);
    void api
      .startRecipeCooking(recipeId)
      .then(() => api.getRecipe<RecipeDetail>(recipeId))
      .then((result) => {
        if (!active) return;
        setRecipe(result);
        const initial: Record<string, TimerState> = {};
        result.instructions.forEach((instruction, index) =>
          extractTimers(instruction, index).forEach((timer) => {
            initial[timer.key] = {
              ...timer,
              remaining: timer.duration,
              running: false,
              paused: false,
              flags: [],
            };
          }),
        );
        setTimers(initial);
      })
      .catch((next) => {
        if (active)
          setError(next instanceof Error ? next.message : "Cooking mode could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [api, recipeId]);
  useEffect(() => {
    let active = true;
    const prepare = async () => {
      try {
        if (!FileSystem.cacheDirectory) return;
        const uri = `${FileSystem.cacheDirectory}ecochef-soothing-chime.wav`;
        await FileSystem.writeAsStringAsync(uri, createChimeBase64(), {
          encoding: FileSystem.EncodingType.Base64,
        });
        await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "duckOthers" });
        if (active) setChimeUri(uri);
      } catch {
        if (active) setChimeUri(undefined);
      }
    };
    void prepare();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const running = (Object.values(timers) as TimerState[]).some((timer) => timer.running);
    if (!running) return;
    const interval = setInterval(
      () =>
        setTimers((current) => {
          let changed = false;
          const now = Date.now();
          const next = { ...current };
          (Object.entries(current) as Array<[string, TimerState]>).forEach(([key, timer]) => {
            if (!timer.running || !timer.endAt) return;
            const remaining = Math.max(0, Math.ceil((timer.endAt - now) / 1000));
            if (remaining !== timer.remaining) {
              changed = true;
              next[key] = {
                ...timer,
                remaining,
                running: remaining > 0,
                paused: false,
              };
            }
          });
          return changed ? next : current;
        }),
      250,
    );
    return () => clearInterval(interval);
  }, [timers]);
  useEffect(() => {
    (Object.values(timers) as TimerState[]).forEach((timer) => {
      if (timer.remaining === 0 && !notifiedRef.current.has(timer.key)) {
        notifiedRef.current.add(timer.key);
        Vibration.vibrate([0, 220, 120, 300]);
        if (chimeUri)
          void chimePlayer
            .seekTo(0)
            .then(() => chimePlayer.play())
            .catch(() => Speech.speak("Timer complete", { rate: 0.85, pitch: 1.05 }));
        else Speech.speak("Timer complete", { rate: 0.85, pitch: 1.05 });
      }
    });
  }, [timers, chimeUri, chimePlayer]);
  useEffect(
    () => () => {
      void Speech.stop();
      voiceWantedRef.current = false;
      if (restartingRef.current) clearTimeout(restartingRef.current);
      try {
        voicePackageRef.current?.ExpoSpeechRecognitionModule.abort();
      } catch {}
      voiceSubscriptionsRef.current.forEach((subscription) => subscription.remove());
    },
    [],
  );

  const stepTimers = recipe
    ? extractTimers(recipe.instructions[step], step)
        .map((timer) => timers[timer.key])
        .filter((timer): timer is TimerState => Boolean(timer))
    : [];
  const progress = recipe ? (step + 1) / recipe.instructions.length : 0;
  const move = (direction: number) => {
    if (!recipe) return;
    void Speech.stop();
    setReading(false);
    setStep((current) =>
      Math.max(0, Math.min(recipe.instructions.length - 1, current + direction)),
    );
  };
  const readAloud = () => {
    if (!recipe) return;
    if (reading) {
      void Speech.stop();
      setReading(false);
      return;
    }
    setReading(true);
    Speech.speak(`Step ${step + 1}. ${recipe.instructions[step]}`, {
      rate: 0.88,
      pitch: 1,
      onDone: () => setReading(false),
      onStopped: () => setReading(false),
      onError: () => setReading(false),
    });
  };
  const updateTimer = (key: string, change: (timer: TimerState) => TimerState) =>
    setTimers((current) => ({ ...current, [key]: change(current[key]) }));
  const toggleTimer = (key: string) =>
    updateTimer(key, (timer) =>
      timer.remaining === 0
        ? timer
        : timer.running
          ? timer
          : {
              ...timer,
              running: true,
              paused: false,
              endAt: Date.now() + timer.remaining * 1000,
            },
    );
  const pauseTimer = (key: string) =>
    updateTimer(key, (timer) => {
      const remaining = timer.endAt
        ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000))
        : timer.remaining;
      return {
        ...timer,
        remaining,
        running: false,
        paused: true,
        endAt: undefined,
      };
    });
  const resetTimer = (key: string) => {
    notifiedRef.current.delete(key);
    updateTimer(key, (timer) => ({
      ...timer,
      remaining: timer.duration,
      running: false,
      paused: false,
      endAt: undefined,
      flags: [],
    }));
  };
  const flagTimer = (key: string) =>
    updateTimer(key, (timer) => ({
      ...timer,
      flags: [...timer.flags, timer.duration - timer.remaining],
    }));
  const finishCooking = async () => {
    if (finishing) return;
    setFinishing(true);
    const date = plannedDate ?? new Date().toISOString().slice(0, 10);
    try {
      if (deductIngredients && recipe) {
        const inventory = await api.getMyInventory<InventoryList>();
        for (const required of recipe.ingredients) {
          const needed = parsedQuantity(required.quantity);
          const stocked = inventory.items.find(
            (item) =>
              ingredientKey(item.name) === ingredientKey(required.name) &&
              parsedQuantity(item.quantity)?.unit === needed?.unit,
          );
          const available = stocked && parsedQuantity(stocked.quantity);
          if (!stocked || !needed || !available) continue;
          const remaining = Math.max(0, available.amount - needed.amount);
          await api.updateInventoryItem(stocked.id, {
            name: stocked.name,
            quantity: quantityText(remaining, available.displayUnit, available.factor),
            expiry_date: stocked.expiry_date,
            category: stocked.category,
            source: stocked.source,
            icon: stocked.icon,
          });
        }
      }
      await markMealCooked(recipeId, date);
      router.replace({ pathname: "/(tabs)/plan", params: { date } });
    } catch (next) {
      setVoiceNotice({
        title: "Could not finish cooking",
        message:
          next instanceof Error ? next.message : "EcoChef could not update your Ingredient List.",
      });
      setFinishing(false);
    }
  };
  const handleVoiceCommand = (transcript: string) => {
    const command = transcript.toLowerCase().trim();
    const now = Date.now();
    if (!command || (command === commandRef.current.text && now - commandRef.current.time < 1800))
      return;
    commandRef.current = { text: command, time: now };
    if (/\b(next|forward)\b/.test(command)) {
      setStep((current) => Math.min(instructionsRef.current.length - 1, current + 1));
      setVoiceMessage("Next step");
    } else if (/\b(previous|back|return)\b/.test(command)) {
      setStep((current) => Math.max(0, current - 1));
      setVoiceMessage("Previous step");
    } else if (/\b(read|repeat)\b/.test(command)) {
      const current = stepRef.current;
      Speech.speak(`Step ${current + 1}. ${instructionsRef.current[current]}`, {
        rate: 0.88,
      });
      setVoiceMessage("Reading this step");
    } else setVoiceMessage(`Heard “${transcript}” · say next or previous`);
  };
  const startRecognizer = (voicePackage: VoicePackage) => {
    try {
      voicePackage.ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
        requiresOnDeviceRecognition: false,
        contextualStrings: [
          "next",
          "next step",
          "previous",
          "previous step",
          "back",
          "return",
          "read",
          "repeat",
        ],
      });
    } catch {
      setVoiceMessage("Voice control could not start.");
      setVoiceEnabled(false);
      voiceWantedRef.current = false;
    }
  };
  const toggleVoice = async () => {
    if (voiceEnabled) {
      voiceWantedRef.current = false;
      setVoiceEnabled(false);
      setListening(false);
      setVoiceMessage(undefined);
      try {
        voicePackageRef.current?.ExpoSpeechRecognitionModule.stop();
      } catch {}
      return;
    }
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      setVoiceNotice({
        title: "Open the EcoChef app",
        message:
          "Speaking Mode is not available in Expo Go. Build and open the installed EcoChef development app to use hands-free cooking commands.",
      });
      return;
    }
    try {
      const voicePackage = require("expo-speech-recognition") as VoicePackage;
      voicePackageRef.current = voicePackage;
      if (!voicePackage.ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setVoiceNotice({
          title: "Speech recognition unavailable",
          message:
            "This device does not currently have a speech-recognition service enabled. Check the device’s speech services and try again.",
        });
        return;
      }
      const permission = await voicePackage.ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setVoiceNotice({
          title: "Microphone permission needed",
          message:
            "Allow microphone and speech-recognition access in your device settings to use hands-free cooking commands.",
        });
        return;
      }
      if (!voiceSubscriptionsRef.current.length) {
        voiceSubscriptionsRef.current = [
          voicePackage.ExpoSpeechRecognitionModule.addListener("start", () => setListening(true)),
          voicePackage.ExpoSpeechRecognitionModule.addListener("end", () => {
            setListening(false);
            if (voiceWantedRef.current)
              restartingRef.current = setTimeout(() => startRecognizer(voicePackage), 500);
          }),
          voicePackage.ExpoSpeechRecognitionModule.addListener("result", (event) => {
            const transcript = event.results[0]?.transcript ?? "";
            if (transcript) handleVoiceCommand(transcript);
          }),
          voicePackage.ExpoSpeechRecognitionModule.addListener("error", (event) => {
            if (event.error === "aborted" || event.error === "no-speech") return;
            setVoiceMessage(event.message || "Voice recognition paused.");
            if (
              event.error === "not-allowed" ||
              event.error === "service-not-allowed" ||
              event.error === "language-not-supported" ||
              event.error === "audio-capture"
            ) {
              voiceWantedRef.current = false;
              setVoiceEnabled(false);
              setListening(false);
              setVoiceNotice({
                title: "Speaking mode stopped",
                message:
                  event.message ||
                  "EcoChef could not access this device’s speech-recognition service.",
              });
            }
          }),
        ];
      }
      voiceWantedRef.current = true;
      setVoiceEnabled(true);
      setVoiceMessage("Listening · say “next”, “previous”, or “read”");
      startRecognizer(voicePackage);
    } catch {
      setVoiceMessage(undefined);
      setVoiceEnabled(false);
      voiceWantedRef.current = false;
      setVoiceNotice({
        title: "Rebuild EcoChef",
        message:
          "This installed app was built before Speaking Mode was added. Rebuild and reinstall EcoChef, then try again.",
      });
    }
  };

  if (!recipe)
    return (
      <View style={styles.loading}>
        {error ? (
          <>
            <Ionicons name="alert-circle-outline" size={35} color={palette.ce78b56} />
            <Text style={styles.errorTitle}>Cooking mode unavailable</Text>
            <Text style={styles.errorCopy}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => goBackOrReplace("/(tabs)/recipes")}>
              <Text style={styles.retryText}>Go back</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={GREEN} />
            <Text style={styles.loadingText}>Preparing cooking mode…</Text>
          </>
        )}
      </View>
    );

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 10,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close cooking mode"
          style={styles.circle}
          onPress={() => goBackOrReplace({ pathname: "/recipes/[recipeId]", params: { recipeId } })}
        >
          <Ionicons name="close" size={20} color={palette.cb9c3d1} />
        </Pressable>
        <Text style={styles.stepCount}>
          STEP {step + 1} OF {recipe.instructions.length}
        </Text>
        <Pressable
          accessibilityLabel="Read instruction aloud"
          style={[styles.circle, reading && styles.circleActive]}
          onPress={readAloud}
        >
          <Ionicons
            name={reading ? "volume-high" : "volume-medium-outline"}
            size={20}
            color={reading ? GREEN : palette.cb9c3d1}
          />
        </Pressable>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <ScrollView
        style={styles.main}
        contentContainerStyle={styles.mainContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.recipeTitle}>{recipe.title}</Text>
        <Text style={styles.instruction}>{recipe.instructions[step]}</Text>
        {stepTimers.map((timer) => (
          <View key={timer.key} style={styles.timerCard}>
            <Text style={styles.timerLabel}>{timer.label.toUpperCase()} TIMER</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                timer.running ? "Timer running" : timer.paused ? "Resume timer" : "Start timer"
              }
              onPress={() => toggleTimer(timer.key)}
              style={[styles.timerFace, timer.running && styles.timerFaceRunning]}
            >
              <Ionicons
                name="timer-outline"
                size={19}
                color={timer.remaining === 0 ? GREEN : palette.cff7a1a}
              />
              <Text style={[styles.timerValue, timer.remaining === 0 && styles.timerDone]}>
                {formatDuration(timer.remaining)}
              </Text>
              <Text style={styles.tapHint}>
                {timer.remaining === 0
                  ? "Time is up"
                  : timer.running
                    ? "Running"
                    : timer.paused
                      ? "Tap to resume"
                      : "Tap to begin"}
              </Text>
            </Pressable>
            {timer.running ? (
              <View style={styles.timerActions}>
                <Pressable style={styles.timerSecondary} onPress={() => flagTimer(timer.key)}>
                  <Ionicons name="flag-outline" size={15} color={palette.cd7dfeb} />
                  <Text style={styles.timerSecondaryText}>Flag</Text>
                </Pressable>
                <Pressable style={styles.timerPrimary} onPress={() => pauseTimer(timer.key)}>
                  <Ionicons name="pause" size={15} color={palette.cfff} />
                  <Text style={styles.timerPrimaryText}>Pause</Text>
                </Pressable>
              </View>
            ) : timer.paused ? (
              <Pressable style={styles.reset} onPress={() => resetTimer(timer.key)}>
                <Ionicons name="refresh" size={15} color={palette.cfff} />
                <Text style={styles.timerPrimaryText}>Reset timer</Text>
              </Pressable>
            ) : timer.remaining === 0 ? (
              <Pressable style={styles.reset} onPress={() => resetTimer(timer.key)}>
                <Ionicons name="refresh" size={15} color={palette.cfff} />
                <Text style={styles.timerPrimaryText}>Reset timer</Text>
              </Pressable>
            ) : null}
            {timer.flags.length > 0 && (
              <View style={styles.flags}>
                <Text style={styles.flagsTitle}>FLAGGED TIMES</Text>
                {timer.flags.map((flag, index) => (
                  <View key={`${flag}-${index}`} style={styles.flagRow}>
                    <View style={styles.flagDot} />
                    <Text style={styles.flagName}>Flag {index + 1}</Text>
                    <Text style={styles.flagTime}>{formatDuration(flag)} elapsed</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
        <View style={styles.assistance}>
          <Pressable
            style={[styles.assistButton, reading && styles.assistActive]}
            onPress={readAloud}
          >
            <Ionicons
              name={reading ? "stop-circle-outline" : "volume-high-outline"}
              size={18}
              color={reading ? palette.cfff : GREEN}
            />
            <Text style={[styles.assistText, reading && styles.assistTextActive]}>
              {reading ? "Stop reading" : "Read Aloud"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.assistButton, voiceEnabled && styles.voiceActive]}
            onPress={() => void toggleVoice()}
          >
            <MaterialCommunityIcons
              name={voiceEnabled ? "microphone" : "microphone-outline"}
              size={19}
              color={voiceEnabled ? palette.cfff : GREEN}
            />
            <Text style={[styles.assistText, voiceEnabled && styles.assistTextActive]}>
              {voiceEnabled ? (listening ? "Listening" : "Voice on") : "Speaking Mode"}
            </Text>
          </Pressable>
        </View>
        {voiceMessage && <Text style={styles.voiceMessage}>{voiceMessage}</Text>}
      </ScrollView>
      <View style={styles.navigation}>
        <Pressable
          disabled={step === 0}
          style={[styles.previous, step === 0 && styles.disabled]}
          onPress={() => move(-1)}
        >
          <Ionicons name="chevron-back" size={18} color={palette.ce5eaf1} />
          <Text style={styles.previousText}>Previous</Text>
        </Pressable>
        {step === recipe.instructions.length - 1 ? (
          <Pressable
            disabled={finishing}
            style={[styles.finish, finishing && styles.disabled]}
            onPress={() => void finishCooking()}
          >
            <Ionicons name="checkmark" size={18} color={palette.cfff} />
            <Text style={styles.nextText}>{finishing ? "Updating…" : "Finish"}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.next} onPress={() => move(1)}>
            <Text style={styles.nextText}>Next Step</Text>
            <Ionicons name="chevron-forward" size={18} color={palette.cfff} />
          </Pressable>
        )}
      </View>
      <AppMessageModal
        visible={voiceNotice !== undefined}
        title={voiceNotice?.title ?? "Speaking Mode"}
        message={voiceNotice?.message ?? ""}
        tone="info"
        onClose={() => setVoiceNotice(undefined)}
      />
      <Modal
        visible={recipe !== undefined && deductIngredients === undefined}
        transparent
        animationType="fade"
        onRequestClose={() =>
          goBackOrReplace({ pathname: "/recipes/[recipeId]", params: { recipeId } })
        }
      >
        <View style={choiceStyles.overlay}>
          <View style={choiceStyles.card}>
            <View style={choiceStyles.icon}>
              <MaterialCommunityIcons name="basket-check-outline" size={28} color={GREEN} />
            </View>
            <Text style={choiceStyles.title}>Update ingredients after cooking?</Text>
            <Text style={choiceStyles.copy}>
              Choose whether EcoChef should deduct compatible recipe quantities from your Ingredient
              List when you finish. Ambiguous conversions, such as slices versus whole pieces, will
              not be guessed.
            </Text>
            <Pressable style={choiceStyles.primary} onPress={() => setDeductIngredients(true)}>
              <Ionicons name="checkmark-circle-outline" size={18} color={palette.cfff} />
              <Text style={choiceStyles.primaryText}>Automatically deduct ingredients</Text>
            </Pressable>
            <Pressable style={choiceStyles.secondary} onPress={() => setDeductIngredients(false)}>
              <Ionicons name="eye-outline" size={18} color={palette.c486258} />
              <Text style={choiceStyles.secondaryText}>View cooking mode only</Text>
            </Pressable>
            <Pressable
              style={choiceStyles.cancel}
              onPress={() =>
                goBackOrReplace({ pathname: "/recipes/[recipeId]", params: { recipeId } })
              }
            >
              <Text style={choiceStyles.cancelText}>Cancel cooking</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const choiceStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: palette.crgba_8_18_31_72,
  },
  card: {
    width: "100%",
    maxWidth: 370,
    alignItems: "center",
    padding: 24,
    borderRadius: 24,
    backgroundColor: palette.cfff,
  },
  icon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: palette.ce7f7ed,
  },
  title: {
    marginTop: 15,
    color: palette.c1d382c,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.black,
    textAlign: "center",
  },
  copy: {
    marginTop: 8,
    color: palette.c687a71,
    fontSize: typography.mobile.rawSize.s12,
    lineHeight: 18,
    textAlign: "center",
  },
  primary: {
    width: "100%",
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    borderRadius: 14,
    backgroundColor: GREEN,
  },
  primaryText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  secondary: {
    width: "100%",
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: palette.ceef7f1,
  },
  secondaryText: {
    color: palette.c315b47,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.black,
  },
  cancel: { padding: 11, marginTop: 3 },
  cancelText: {
    color: palette.c89968f,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.bold,
  },
});

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 14, backgroundColor: colors.consumerCanvasDark },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: colors.consumerCanvasDark,
  },
  loadingText: { marginTop: 12, color: palette.caab5c5 },
  errorTitle: {
    marginTop: 12,
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s19,
    fontWeight: typography.weight.black,
  },
  errorCopy: { marginTop: 7, color: palette.c9eabbd, textAlign: "center" },
  retry: {
    marginTop: 18,
    paddingHorizontal: 19,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: GREEN,
  },
  retryText: { color: palette.cfff, fontWeight: typography.weight.black },
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  circle: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: palette.c1c293b,
  },
  circleActive: { backgroundColor: palette.c173a31 },
  stepCount: {
    color: palette.c8e9aad,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
    letterSpacing: 1.1,
  },
  progressTrack: {
    height: 5,
    overflow: "hidden",
    marginTop: 5,
    borderRadius: 3,
    backgroundColor: palette.c223047,
  },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: GREEN },
  main: { flex: 1 },
  mainContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 24,
  },
  recipeTitle: {
    color: palette.c66748a,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
    letterSpacing: 0.7,
    textAlign: "center",
    textTransform: "uppercase",
  },
  instruction: {
    maxWidth: 430,
    alignSelf: "center",
    marginTop: 16,
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s23,
    lineHeight: 31,
    fontWeight: typography.weight.black,
    textAlign: "center",
  },
  timerCard: {
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    marginTop: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.c2a374b,
    borderRadius: 18,
    backgroundColor: palette.c182336,
  },
  timerLabel: {
    color: palette.c77859a,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.black,
    letterSpacing: 0.8,
    textAlign: "center",
  },
  timerFace: {
    alignItems: "center",
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: 14,
  },
  timerFaceRunning: { backgroundColor: palette.c1c2a3f },
  timerValue: {
    marginTop: 2,
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s35,
    fontWeight: typography.weight.extrabold,
    fontVariant: ["tabular-nums"],
    letterSpacing: 2,
  },
  timerDone: { color: GREEN },
  tapHint: {
    marginTop: 3,
    color: palette.c8794a8,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.extrabold,
    textTransform: "uppercase",
  },
  timerActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 9,
    marginTop: 9,
  },
  timerSecondary: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: palette.c2c394d,
  },
  timerSecondaryText: {
    color: palette.cd7dfeb,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
  },
  timerPrimary: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: GREEN,
  },
  timerPrimaryText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
  },
  reset: {
    height: 36,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 9,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: palette.ce16f28,
  },
  flags: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.c2a374b,
  },
  flagsTitle: {
    color: palette.c758399,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.black,
    letterSpacing: 0.8,
  },
  flagRow: { height: 28, flexDirection: "row", alignItems: "center" },
  flagDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.cff8a32 },
  flagName: {
    flex: 1,
    marginLeft: 8,
    color: palette.cdce3ed,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.extrabold,
  },
  flagTime: {
    color: palette.c8e9aaf,
    fontSize: typography.mobile.rawSize.s10,
    fontVariant: ["tabular-nums"],
  },
  assistance: {
    flexDirection: "row",
    gap: 9,
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    marginTop: 24,
  },
  assistButton: {
    flex: 1,
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: palette.c2a674e,
    borderRadius: 13,
    backgroundColor: palette.c132439,
  },
  assistActive: { borderColor: GREEN, backgroundColor: GREEN },
  voiceActive: { borderColor: palette.c2b8b67, backgroundColor: palette.c237754 },
  assistText: {
    color: palette.c8fd8b0,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.black,
  },
  assistTextActive: { color: palette.cfff },
  voiceMessage: {
    marginTop: 9,
    color: palette.c8190a5,
    fontSize: typography.mobile.rawSize.s9,
    textAlign: "center",
  },
  navigation: {
    height: 66,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previous: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
  },
  previousText: {
    color: palette.ce5eaf1,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.black,
  },
  disabled: { opacity: 0.28 },
  next: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: GREEN,
  },
  finish: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 22,
    borderRadius: 23,
    backgroundColor: palette.cff781a,
  },
  nextText: {
    color: palette.cfff,
    fontSize: typography.mobile.rawSize.s11,
    fontWeight: typography.weight.black,
  },
});
