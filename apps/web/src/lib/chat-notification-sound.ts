export type ChatSoundSettings = {
  enabled: boolean;
  volume: number;
  customSound?: string;
  customSoundName?: string;
};

const key = "ecochef.vendor.chat-sound";
export const chatSoundSettingsEvent = "ecochef:vendor-chat-sound";
const defaults: ChatSoundSettings = { enabled: true, volume: 70 };

export function loadChatSoundSettings(): ChatSoundSettings {
  if (typeof window === "undefined") return defaults;
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return defaults;
  }
}

export function saveChatSoundSettings(settings: ChatSoundSettings) {
  localStorage.setItem(key, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(chatSoundSettingsEvent, { detail: settings }));
}

export async function playChatNotificationSound(settings = loadChatSoundSettings()) {
  if (!settings.enabled || settings.volume <= 0) return;
  const volume = Math.min(1, Math.max(0, settings.volume / 100));
  if (settings.customSound) {
    const audio = new Audio(settings.customSound);
    audio.volume = volume;
    await audio.play();
    return;
  }
  const AudioContextClass = window.AudioContext;
  const context = new AudioContextClass();
  const gain = context.createGain();
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.setValueAtTime(880, context.currentTime + 0.11);
  gain.gain.setValueAtTime(volume * 0.18, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.28);
  oscillator.addEventListener("ended", () => void context.close());
}
