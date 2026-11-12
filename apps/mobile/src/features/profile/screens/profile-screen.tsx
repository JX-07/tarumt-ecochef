import { apiBaseUrl } from "../../../lib/api-url";
import { Text, TextInput } from "../../../shared/components/themed-text";
import { colors, palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  BackHandler,
  Image,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Switch,
  UIManager,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createMobileApi } from "../../../lib/api";
import { PAGE_TOP_GAP } from "../../../shared/components/page-header";
import { useAuth } from "../../auth/auth-provider";
import { type CookingGroupList, type CookingGroup } from "../../social/cooking-group";


type UnitPreference = "metric" | "imperial";
type ProfileVisibility = "public" | "friends_only" | "hidden";
type AddressInput = {
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  postal_code: string;
  is_default?: boolean;
};
type SavedAddress = AddressInput & { id: string; is_default: boolean };
type ConsumerProfile = {
  id: string;
  firebase_uid: string;
  email: string;
  name: string;
  phone_number?: string;
  bio?: string;
  cuisine_preferences: string[];
  dietary_restrictions: string[];
  allergies: string[];
  food_dislikes: string[];
  profile_visibility: ProfileVisibility;
  preferred_units: UnitPreference;
  addresses: SavedAddress[];
};
type Draft = Omit<
  ConsumerProfile,
  "id" | "firebase_uid" | "email" | "addresses"
>;
type Section =
  | "overview"
  | "personal"
  | "preferences"
  | "addresses"
  | "privacy"
  | "settings"
  | "friends"
  | "purchases"
  | "promos";
type ThemeChoice = "Light" | "Dark" | "System";
type Dialog = {
  title: string;
  copy: string;
  confirm: string;
  destructive?: boolean;
  onConfirm?: () => void | Promise<void>;
} | null;
type Icon = keyof typeof Ionicons.glyphMap;

const splitTerms = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const titleFor: Record<Exclude<Section, "overview">, string> = {
  personal: "Personal Information",
  preferences: "Preferences & Allergies",
  addresses: "Delivery Addresses",
  privacy: "Privacy & Security",
  settings: "App Settings",
  friends: "Find Friends",
  purchases: "Purchase History",
  promos: "Promo Codes",
};
const subtitleFor: Partial<Record<Section, string>> = {
  privacy: "Control your account and your data",
  settings: "Make EcoChef feel like yours",
  friends: "Cook and save food together",
  purchases: "Recent orders and receipts",
  promos: "Codes saved for your orders",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.c9ba6a1}
      />
    </View>
  );
}

function ListRow({
  icon,
  label,
  caption,
  onPress,
  danger,
  right,
}: {
  icon: Icon;
  label: string;
  caption?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
}) {
  return (
    <Pressable
      disabled={!onPress}
      style={[styles.row, { minHeight: 52, paddingVertical: 10 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={danger ? palette.cf0525f : palette.c9aa8a4} />
      <View style={[styles.rowBody, { flexShrink: 1 }]}>
        <Text
          style={[
            styles.rowText,
            danger && styles.dangerText,
            { flexShrink: 1 },
          ]}
        >
          {label}
        </Text>
        {caption && (
          <Text
            style={[styles.rowCaption, { flexShrink: 1, flexWrap: "wrap" }]}
          >
            {caption}
          </Text>
        )}
      </View>
      {right ??
        (onPress && (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={danger ? palette.cf4b4ba : palette.cccd4d0}
          />
        ))}
    </Pressable>
  );
}

function Group({
  label,
  children,
  danger,
}: {
  label: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <>
      <Text style={[styles.groupLabel, danger && styles.dangerLabel]}>
        {label}
      </Text>
      <View style={[styles.list, danger && styles.dangerList]}>{children}</View>
    </>
  );
}

export function ProfileScreen() {
  const { user, signOut } = useAuth();
  const params = useLocalSearchParams<{ section?: string; mode?: string }>();
  const requestedSection = params.section === "friends" ? "friends" : "overview";
  const groupMode = requestedSection === "friends" && params.mode === "group";
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const systemScheme = useColorScheme();
  const api = useMemo(
    () => createMobileApi(apiBaseUrl, () => user?.getIdToken()),
    [user],
  );
  const [section, setSection] = useState<Section>(requestedSection);
  const [friendsPage, setFriendsPage] = useState<"friends" | "blocked" | "profile">("friends");
  const [friendsRefreshing, setFriendsRefreshing] = useState(false);
  const [friendsRefreshSignal, setFriendsRefreshSignal] = useState(0);
  const [profile, setProfile] = useState<ConsumerProfile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [lastAvatarChange, setLastAvatarChange] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [publicProfile, setPublicProfile] = useState(true);
  const [shareStats, setShareStats] = useState(true);
  const [theme, setTheme] = useState<ThemeChoice>("System");
  const [address, setAddress] = useState<AddressInput>({
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    postal_code: "",
    is_default: false,
  });

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const next = await api.getMyConsumerProfile<ConsumerProfile>();
      setProfile(next);
      setDraft({
        name: next.name,
        phone_number: next.phone_number ?? "",
        bio: next.bio ?? "",
        cuisine_preferences: next.cuisine_preferences,
        dietary_restrictions: next.dietary_restrictions,
        allergies: next.allergies,
        food_dislikes: next.food_dislikes,
        profile_visibility: next.profile_visibility,
        preferred_units: next.preferred_units,
      });
    } catch {
      // Keep profile subpages usable while the API is temporarily unavailable.
      setDraft({
        name: user?.displayName ?? "EcoChef member",
        phone_number: "",
        bio: "",
        cuisine_preferences: [],
        dietary_restrictions: [],
        allergies: [],
        food_dislikes: [],
        profile_visibility: "public",
        preferred_units: "metric",
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [user]);
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  }, [section, friendsPage]);
  useEffect(() => {
    void AsyncStorage.getItem("ecochef.profile.theme").then((stored) => {
      if (stored === "Light" || stored === "Dark" || stored === "System")
        setTheme(stored);
    });
  }, []);
  useEffect(() => {
    const owner = user?.uid ?? "guest";
    void AsyncStorage.multiGet([
      `ecochef.profile.avatar.${owner}`,
      `ecochef.profile.avatar-date.${owner}`,
    ]).then((values) => {
      setAvatarUri(values[0][1]);
      setLastAvatarChange(values[1][1]);
    });
  }, [user?.uid]);
  useEffect(
    () => navigation.addListener("focus", () => {
      setSection(requestedSection);
      setFriendsPage("friends");
    }),
    [navigation, requestedSection],
  );
  useEffect(() => {
    navigation.setOptions({
      tabBarStyle:
        section === "overview"
          ? {
              height: 66,
              paddingTop: 6,
              borderTopColor: palette.ce3e7e4,
              backgroundColor: palette.cffffff,
            }
          : { display: "none" },
    });
  }, [navigation, section]);
  const leaveProfile = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, []);
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (groupMode && friendsPage !== "friends") setFriendsPage("friends");
          else if (groupMode) leaveProfile();
          else if (section !== "overview") setSection("overview");
          else leaveProfile();
          return true;
        },
      );
      return () => subscription.remove();
    }, [friendsPage, groupMode, leaveProfile, section]),
  );
  const updateDraft = (
    key: keyof Draft,
    value: string | string[] | UnitPreference | ProfileVisibility,
  ) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const changeAvatar = async () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (lastAvatarChange === today) {
      setMessage("Your profile photo can only be changed once per day. Please try again tomorrow.");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Allow photo access in your device settings to choose a profile image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;

    try {
      const owner = user?.uid ?? "guest";
      const destination = `${FileSystem.documentDirectory}ecochef-avatar-${owner}.jpg`;
      await FileSystem.deleteAsync(destination, { idempotent: true });
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: destination });
      await AsyncStorage.multiSet([
        [`ecochef.profile.avatar.${owner}`, destination],
        [`ecochef.profile.avatar-date.${owner}`, today],
      ]);
      setAvatarUri(destination);
      setLastAvatarChange(today);
      setMessage("Profile photo updated successfully. You can change it again tomorrow.");
    } catch {
      setMessage("EcoChef could not save that profile photo. Please choose another image.");
    }
  };
  const saveProfile = async () => {
    if (!draft || !draft.name.trim())
      return setMessage("Add your name before saving.");
    setSaving(true);
    try {
      const updated = await api.updateMyConsumerProfile<ConsumerProfile>({
        ...draft,
        name: draft.name.trim(),
        phone_number: draft.phone_number?.trim() || undefined,
      });
      setProfile(updated);
      setDraft({ ...updated, phone_number: updated.phone_number ?? "" });
      if (section === "preferences") {
        setMessage("Successfully saved preferences and allergies.");
      } else {
        setSection("overview");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "We could not save your profile.",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveAddress = async () => {
    if (
      !address.address_line_1 ||
      !address.city ||
      !address.state ||
      !address.postal_code
    )
      return setMessage("Complete the required address fields.");
    setSaving(true);
    try {
      await api.addMyAddress<SavedAddress>(address);
      await load();
      setSection("addresses");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "We could not add that address.",
      );
    } finally {
      setSaving(false);
    }
  };
  const requestDeletion = () =>
    setDialog({
      title: "Request account deletion?",
      copy: "Your account will be scheduled for deletion after a 30-day retention period.",
      confirm: "Request deletion",
      destructive: true,
      onConfirm: async () => {
        try {
          const request = await api.requestMyAccountDeletion<{
            scheduled_for: string;
          }>();
          setMessage(
            `Deletion is scheduled for ${new Date(request.scheduled_for).toLocaleDateString()}.`,
          );
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "We could not submit your deletion request.",
          );
        }
      },
    });
  const go = (next: Section) => {
    setMessage(null);
    if (next === "friends") setFriendsPage("friends");
    setSection(next);
  };

  if (loading)
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={palette.c10a25a} />
        <Text style={styles.loadingText}>Loading your profile…</Text>
      </View>
    );
  const name = profile?.name ?? user?.displayName ?? "EcoChef member";
  const dark =
    theme === "Dark" || (theme === "System" && systemScheme === "dark");
  const selectTheme = (next: ThemeChoice) => {
    setTheme(next);
    void AsyncStorage.setItem("ecochef.profile.theme", next);
  };
  return (
    <View style={[styles.root, dark && { backgroundColor: palette.c17211f }]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + PAGE_TOP_GAP }]}
        showsVerticalScrollIndicator={false}
        refreshControl={section === "friends" ? <RefreshControl refreshing={friendsRefreshing} onRefresh={() => { setFriendsRefreshing(true); setFriendsRefreshSignal(value => value + 1); }} tintColor={colors.primaryStrong} colors={[colors.primaryStrong]} /> : undefined}
      >
        {section === "overview" ? (
          <Overview
            name={name}
            profile={profile}
            draft={draft}
            avatarUri={avatarUri}
            changeAvatar={changeAvatar}
            go={go}
            onBack={leaveProfile}
            openLogout={() =>
              setDialog({
                title: "Log out of EcoChef?",
                copy: "You can sign back in anytime to continue planning meals and reducing food waste.",
                confirm: "Log out",
                destructive: true,
                onConfirm: async () => {
                  await signOut();
                  router.replace("/(auth)/sign-in");
                },
              })
            }
          />
        ) : (
          <>
            <View style={styles.pageHeading}>
              <Pressable
                style={[
                  styles.backButton,
                  {
                    borderRadius: 20,
                    backgroundColor: palette.ceef1f0,
                    borderColor: palette.ceef1f0,
                  },
                ]}
                onPress={() => section === "friends" && friendsPage !== "friends" ? setFriendsPage("friends") : groupMode ? router.back() : go("overview")}
                accessibilityLabel={section === "friends" && friendsPage !== "friends" ? "Back to friends" : "Back to profile"}
              >
                <Ionicons name="chevron-back" size={22} color={palette.c64716d} />
              </Pressable>
              <View>
                <Text style={[styles.pageTitle, dark && { color: palette.cf6f8f7 }]}>
                  {section === "friends" && friendsPage === "blocked" ? "Blocked User" : section === "friends" && friendsPage === "profile" ? "User Profile" : groupMode ? "Cooking Group" : titleFor[section]}
                </Text>
                {subtitleFor[section] && !(section === "friends" && friendsPage !== "friends") && (
                  <Text style={styles.pageSubtitle}>
                    {groupMode ? "Choose which friends appear in your cooking group" : subtitleFor[section]}
                  </Text>
                )}
              </View>
              {section === "preferences" && (
                <Pressable
                  style={styles.saveTop}
                  onPress={() => void saveProfile()}
                >
                  <Text style={styles.saveTopText}>Save</Text>
                </Pressable>
              )}
            </View>
            {message && (
              <Pressable
                style={styles.message}
                onPress={() => setMessage(null)}
              >
                <Text style={styles.messageText}>{message}</Text>
              </Pressable>
            )}
            {section === "personal" && draft && (
              <Personal
                draft={draft}
                email={profile?.email ?? ""}
                update={updateDraft}
                save={saveProfile}
                saving={saving}
              />
            )}
            {section === "preferences" && draft && (
              <Preferences draft={draft} update={updateDraft} />
            )}
            {section === "addresses" && (
              <Addresses
                profile={profile}
                address={address}
                setAddress={setAddress}
                save={saveAddress}
                saving={saving}
                api={api}
                reload={load}
              />
            )}
            {section === "privacy" && (
              <Privacy
                publicProfile={publicProfile}
                setPublicProfile={setPublicProfile}
                shareStats={shareStats}
                setShareStats={setShareStats}
                requestDeletion={requestDeletion}
                openDialog={setDialog}
              />
            )}
            {section === "settings" && (
              <Settings
                theme={theme}
                setTheme={selectTheme}
                openDialog={setDialog}
              />
            )}
            {section === "friends" && <Friends api={api} openDialog={setDialog} page={friendsPage} onPageChange={setFriendsPage} groupMode={groupMode} currentUserId={profile?.id} currentUserAvatar={avatarUri} refreshSignal={friendsRefreshSignal} onRefreshDone={setFriendsRefreshing} />}
            {section === "purchases" && <Purchases api={api} />}
            {section === "promos" && <Promos api={api} />}
          </>
        )}
      </ScrollView>
      <Modal
        transparent
        visible={!!dialog}
        animationType="fade"
        onRequestClose={() => setDialog(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.dialog}>
            <View style={styles.dialogIcon}>
              <Ionicons
                name={
                  dialog?.destructive ? "alert-circle-outline" : "leaf-outline"
                }
                size={25}
                color={dialog?.destructive ? palette.cc94c56 : palette.c159b54}
              />
            </View>
            <Text style={styles.dialogTitle}>{dialog?.title}</Text>
            <Text style={styles.dialogCopy}>{dialog?.copy}</Text>
            <Pressable
              style={[
                styles.logoutConfirm,
                !dialog?.destructive && { backgroundColor: palette.c159b54 },
              ]}
              onPress={async () => {
                const action = dialog?.onConfirm;
                setDialog(null);
                await action?.();
              }}
            >
              <Text style={styles.logoutConfirmText}>{dialog?.confirm}</Text>
            </Pressable>
            <Pressable
              style={styles.dialogCancel}
              onPress={() => setDialog(null)}
            >
              <Text style={styles.dialogCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Overview({
  name,
  profile,
  draft,
  avatarUri,
  changeAvatar,
  go,
  onBack,
  openLogout,
}: {
  name: string;
  profile: ConsumerProfile | null;
  draft: Draft | null;
  avatarUri: string | null;
  changeAvatar: () => Promise<void>;
  go: (section: Section) => void;
  onBack: () => void;
  openLogout: () => void;
}) {
  const [previewVisible, setPreviewVisible] = useState(false);
  const cuisineCount = draft?.cuisine_preferences.length ?? 0;
  const dietaryNeeds = (draft?.dietary_restrictions.length ?? 0) + (draft?.allergies.length ?? 0) + (draft?.food_dislikes.length ?? 0);
  return (
    <>
      <View style={styles.overviewHeading}>
        <Pressable style={styles.overviewBack} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Home">
          <Ionicons name="chevron-back" size={22} color={palette.c64716d} />
        </Pressable>
        <Text style={styles.overviewTitle}>Profile</Text>
      </View>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Pressable
            style={styles.avatarPreviewButton}
            onPress={() => setPreviewVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="View profile photo"
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={48} color={palette.c9aa3af} />
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.editBadge, pressed && { opacity: 0.72 }]}
            onPress={() => void changeAvatar()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            accessibilityHint="Profile photos can be changed once per day"
          >
            <Ionicons name="pencil" size={13} color={palette.cfff} />
          </Pressable>
        </View>
        <Text style={styles.memberName}>{name}</Text>
        <Text style={styles.memberCaption}>EcoChef Member since 2024</Text>
        <View style={styles.metrics}>
          <Metric
            icon="restaurant-outline"
            value={`${cuisineCount}`}
            label="CUISINES"
            color={palette.c14a957}
            tint={palette.ceafaf0}
          />
          <Metric
            icon="nutrition-outline"
            value={`${dietaryNeeds}`}
            label="DIETARY NEEDS"
            color={palette.cf37a20}
            tint={palette.cfff3e7}
          />
          <Metric
            icon="location-outline"
            value={`${profile?.addresses.length ?? 0}`}
            label="SAVED PLACES"
            color={palette.c3478f6}
            tint={palette.cecf4ff}
          />
        </View>
      </View>
      <Modal
        transparent
        visible={previewVisible}
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.avatarPreviewOverlay}>
          <Pressable
            style={styles.avatarPreviewClose}
            onPress={() => setPreviewVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close profile photo"
          >
            <Ionicons name="close" size={25} color={palette.cffffff} />
          </Pressable>
          <View style={styles.avatarPreviewFrame}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarPreviewImage} resizeMode="cover" />
            ) : (
              <Ionicons name="person" size={150} color={palette.c9aa3af} />
            )}
          </View>
          <Text style={styles.avatarPreviewName}>{name}</Text>
          <Text style={styles.avatarPreviewHint}>Tap the × button or use your phone’s back button to close</Text>
        </View>
      </Modal>
      <Group label="ACCOUNT">
        <ListRow
          icon="person-outline"
          label="Personal Information"
          onPress={() => go("personal")}
        />
        <ListRow
          icon="notifications-outline"
          label="Notifications & Alerts"
          onPress={() => router.push("/notifications/settings" as never)}
        />
        <ListRow
          icon="shield-checkmark-outline"
          label="Privacy & Security"
          onPress={() => go("privacy")}
        />
        <ListRow
          icon="settings-outline"
          label="App Settings"
          onPress={() => go("settings")}
        />
      </Group>
      <Group label="ORDER">
        <ListRow
          icon="cart-outline"
          label="Purchase History"
          onPress={() => go("purchases")}
        />
        <ListRow
          icon="pricetag-outline"
          label="Promo Codes"
          onPress={() => go("promos")}
        />
      </Group>
      <Group label="SOCIAL">
        <ListRow
          icon="people-outline"
          label="Friends"
          onPress={() => go("friends")}
        />
      </Group>
      <Group label="DIETARY">
        <ListRow
          icon="leaf-outline"
          label="Preferences & Allergies"
          onPress={() => go("preferences")}
        />
      </Group>
      <Pressable style={styles.logout} onPress={openLogout}>
        <Ionicons name="log-out-outline" size={18} color={palette.cf0525f} />
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
    </>
  );
}
function Metric({
  icon,
  value,
  label,
  color,
  tint,
}: {
  icon: Icon;
  value: string;
  label: string;
  color: string;
  tint: string;
}) {
  return (
    <View style={[styles.metric, { backgroundColor: tint }]}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}
function Personal({
  draft,
  email,
  update,
  save,
  saving,
}: {
  draft: Draft;
  email: string;
  update: (key: keyof Draft, value: string | string[] | UnitPreference | ProfileVisibility) => void;
  save: () => void;
  saving: boolean;
}) {
  return (
    <View style={styles.panel}>
      <Field
        label="Full name"
        value={draft.name}
        onChange={(value) => update("name", value)}
      />
      <Field
        label="Phone number"
        value={draft.phone_number ?? ""}
        onChange={(value) => update("phone_number", value)}
        placeholder="Optional"
      />
      <Field
        label="Bio"
        value={draft.bio ?? ""}
        onChange={(value) => update("bio", value)}
        placeholder="Tell the EcoChef community a little about you"
      />
      <Text style={styles.fieldLabel}>Email address</Text>
      <View style={styles.readOnly}>
        <Text>{email}</Text>
      </View>
      <Text style={styles.fieldLabel}>Profile detail visibility</Text>
      <Text style={styles.helper}>Your name, profile icon, and member-since date remain visible.</Text>
      <View style={extraStyles.visibilityOptions}>
        {([
          ["public", "Public", "Anyone can view details"],
          ["friends_only", "Friends only", "Only accepted friends"],
          ["hidden", "Hide", "Hide all profile details"],
        ] as const).map(([value, label, caption]) => (
          <Pressable key={value} style={[extraStyles.visibilityOption, draft.profile_visibility === value && extraStyles.visibilitySelected]} onPress={() => update("profile_visibility", value)}>
            <Ionicons name={draft.profile_visibility === value ? "radio-button-on" : "radio-button-off"} size={18} color={draft.profile_visibility === value ? palette.c16a45b : palette.c9aa6b4} />
            <View style={extraStyles.flex}><Text style={extraStyles.visibilityLabel}>{label}</Text><Text style={styles.helper}>{caption}</Text></View>
          </Pressable>
        ))}
      </View>
      <SaveButton saving={saving} onPress={save} />
    </View>
  );
}
function Preferences({
  draft,
  update,
}: {
  draft: Draft;
  update: (key: keyof Draft, value: string | string[] | UnitPreference | ProfileVisibility) => void;
}) {
  const diets = [
    "Vegan",
    "Vegetarian",
    "Pescatarian",
    "Keto",
    "Paleo",
    "Gluten-Free",
    "Dairy-Free",
    "Halal",
    "Kosher",
    "Low-Carb",
    "Low-Sodium",
    "High-Protein",
  ];
  const allergies = [
    "Nuts",
    "Peanuts",
    "Tree Nuts",
    "Milk",
    "Eggs",
    "Wheat",
    "Gluten",
    "Soy",
    "Fish",
    "Shellfish",
    "Sesame",
    "Sulphites",
  ];
  const dislikes = [
    "Mushrooms",
    "Olives",
    "Cilantro",
    "Onions",
    "Garlic",
    "Spicy Food",
    "Bitter Greens",
    "Blue Cheese",
  ];
  const [custom, setCustom] = useState("");
  const [query, setQuery] = useState("");
  const selectedDislikes = draft.food_dislikes;
  const addAllergy = () => {
    const item = custom.trim().toLowerCase();
    if (item && !draft.allergies.includes(item))
      update("allergies", [...draft.allergies, item]);
    setCustom("");
  };
  const visibleDislikes = dislikes.filter((item) =>
    item.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Text style={styles.formHeading}>Dietary Lifestyle</Text>
      <Text style={styles.helper}>Select all that apply</Text>
      <ChipSet
        values={diets}
        selected={draft.dietary_restrictions}
        onChange={(next) => update("dietary_restrictions", next)}
        tone="green"
      />
      <Text style={styles.formHeading}>Allergies & Intolerances</Text>
      <Text style={styles.helper}>We’ll use this to exclude from recipes</Text>
      <ChipSet
        values={allergies}
        selected={draft.allergies}
        onChange={(next) => update("allergies", next)}
        tone="red"
      />
      <View style={extraStyles.customRow}>
        <TextInput
          value={custom}
          onChangeText={setCustom}
          placeholder="Add custom allergy…"
          placeholderTextColor={palette.c9aa6b4}
          style={extraStyles.customInput}
          onSubmitEditing={addAllergy}
        />
        <Pressable
          style={extraStyles.addButton}
          onPress={addAllergy}
          accessibilityLabel="Add custom allergy"
        >
          <Ionicons name="add" size={22} color={palette.cfff} />
        </Pressable>
      </View>
      <Text style={styles.formHeading}>Food Dislikes</Text>
      <Text style={styles.helper}>We will avoid these in suggestions</Text>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={palette.ca4afab} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search food dislikes"
          placeholderTextColor={palette.ca4afab}
          style={extraStyles.searchInput}
        />
      </View>
      <ChipSet
        values={visibleDislikes}
        selected={selectedDislikes}
        onChange={(next) => update("food_dislikes", next)}
        tone="orange"
      />
      <Text style={styles.formHeading}>Your profile</Text>
      <View style={styles.profileSummary}>
        <View style={styles.chips}>
          {[
            ...draft.dietary_restrictions,
            ...draft.allergies.map((item) => `No ${item}`),
            ...selectedDislikes.map((item) => `Dislikes ${item}`),
          ].map((item, index) => (
            <View
              key={item}
              style={[
                extraStyles.summaryChip,
                {
                  backgroundColor:
                    index % 3 === 0
                      ? palette.ce5f8eb
                      : index % 3 === 1
                        ? palette.cfff0f1
                        : palette.cfff3e5,
                },
              ]}
            >
              <Text
                style={[
                  styles.summaryText,
                  {
                    color:
                      index % 3 === 0
                        ? palette.c159b54
                        : index % 3 === 1
                          ? palette.cf0525f
                          : palette.cf37a20,
                  },
                ]}
              >
                {item}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}
function ChipSet({
  values,
  selected,
  onChange,
  tone,
}: {
  values: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  tone: "green" | "red" | "orange";
}) {
  return (
    <View style={styles.chips}>
      {values.map((value) => {
        const active = selected.includes(value.toLowerCase());
        return (
          <Pressable
            key={value}
            onPress={() =>
              onChange(
                active
                  ? selected.filter((item) => item !== value.toLowerCase())
                  : [...selected, value.toLowerCase()],
              )
            }
            style={[
              styles.chip,
              active &&
                (tone === "green"
                  ? styles.chipGreen
                  : tone === "red"
                    ? styles.chipRed
                    : extraStyles.chipOrange),
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipActiveText]}>
              {active && tone === "red" ? "⚠ " : active ? "✓ " : ""}
              {value}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Addresses({
  profile,
  address,
  setAddress,
  save,
  saving,
  api,
  reload,
}: {
  profile: ConsumerProfile | null;
  address: AddressInput;
  setAddress: (address: AddressInput) => void;
  save: () => void;
  saving: boolean;
  api: ReturnType<typeof createMobileApi>;
  reload: () => Promise<void>;
}) {
  return (
    <>
      <Text style={styles.formHeading}>Saved addresses</Text>
      {profile?.addresses.map((item) => (
        <View style={styles.addressCard} key={item.id}>
          <View>
            <Text style={styles.addressName}>{item.address_line_1}</Text>
            <Text style={styles.addressDetails}>
              {[item.city, item.state, item.postal_code].join(", ")}
            </Text>
          </View>
          <Pressable
            onPress={() => void api.removeMyAddress(item.id).then(reload)}
          >
            <Ionicons name="trash-outline" size={18} color={palette.cd55b63} />
          </Pressable>
        </View>
      ))}
      <Text style={styles.formHeading}>Add a new address</Text>
      <Field
        label="Street address"
        value={address.address_line_1}
        onChange={(value) => setAddress({ ...address, address_line_1: value })}
      />
      <Field
        label="City"
        value={address.city}
        onChange={(value) => setAddress({ ...address, city: value })}
      />
      <Field
        label="State"
        value={address.state}
        onChange={(value) => setAddress({ ...address, state: value })}
      />
      <Field
        label="Postal code"
        value={address.postal_code}
        onChange={(value) => setAddress({ ...address, postal_code: value })}
      />
      <SaveButton saving={saving} onPress={save} label="Add address" />
    </>
  );
}
function Privacy({
  publicProfile,
  setPublicProfile,
  shareStats,
  setShareStats,
  requestDeletion,
  openDialog,
}: {
  publicProfile: boolean;
  setPublicProfile: (value: boolean) => void;
  shareStats: boolean;
  setShareStats: (value: boolean) => void;
  requestDeletion: () => void;
  openDialog: (dialog: Dialog) => void;
}) {
  return (
    <>
      <Group label="ACCOUNT SECURITY">
        <ListRow
          icon="key-outline"
          label="Change password"
          onPress={() =>
            router.push({
              pathname: "/(auth)/forgot-password",
              params: { mode: "change-password" },
            })
          }
        />
      </Group>
      <Group label="PRIVACY">
        <ListRow
          icon="eye-outline"
          label="Public profile"
          caption="Others can find and view your profile"
          right={
            <Switch
              value={publicProfile}
              onValueChange={setPublicProfile}
              trackColor={{ false: palette.cd8e1de, true: palette.c72d19c }}
              thumbColor={palette.cfff}
            />
          }
        />
        <ListRow
          icon="share-social-outline"
          label="Share eco stats"
          caption="Allow EcoChef to collect your data for research purposes"
          right={
            <Switch
              value={shareStats}
              onValueChange={setShareStats}
              trackColor={{ false: palette.cd8e1de, true: palette.c72d19c }}
              thumbColor={palette.cfff}
            />
          }
        />
      </Group>
      <Group label="DANGER ZONE" danger>
        <ListRow
          icon="trash-outline"
          label="Delete account"
          danger
          onPress={requestDeletion}
        />
      </Group>
    </>
  );
}
function Settings({
  theme,
  setTheme,
  openDialog,
}: {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  openDialog: (dialog: Dialog) => void;
}) {
  return (
    <>
      <Group label="APPEARANCE">
        <View style={styles.themeCard}>
          <Text style={styles.fieldLabel}>THEME</Text>
          <View style={styles.themeOptions}>
            {(["Light", "Dark", "System"] as ThemeChoice[]).map((item) => (
              <Pressable
                key={item}
                onPress={() => setTheme(item)}
                style={[
                  styles.themeOption,
                  theme === item && styles.themeActive,
                ]}
              >
                <Ionicons
                  name={
                    item === "Light"
                      ? "sunny-outline"
                      : item === "Dark"
                        ? "moon-outline"
                        : "phone-portrait-outline"
                  }
                  size={18}
                  color={theme === item ? palette.c159b54 : palette.c9aa6b0}
                />
                <Text
                  style={[
                    styles.themeText,
                    theme === item && styles.themeTextActive,
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Group>
      <Group label="DATA & STORAGE">
        <ListRow
          icon="trash-outline"
          label="Clear cache"
          right={<Text style={styles.rowCaption}>128 MB</Text>}
          onPress={() =>
            openDialog({
              title: "Clear temporary data?",
              copy: "This removes cached images and temporary files. Your saved profile and orders stay safe.",
              confirm: "Clear cache",
              onConfirm: () =>
                openDialog({
                  title: "Cache cleared",
                  copy: "Temporary images and data have been cleared.",
                  confirm: "Done",
                }),
            })
          }
        />
      </Group>
      <Group label="ABOUT">
        <ListRow
          icon="information-circle-outline"
          label="App version"
          right={<Text style={styles.rowCaption}>0.2.1</Text>}
        />
        <ListRow
          icon="document-text-outline"
          label="Terms of Service"
          onPress={() =>
            openDialog({
              title: "Terms of Service",
              copy: "EcoChef connects you with local food choices while respecting responsible, fair use.",
              confirm: "Done",
            })
          }
        />
        <ListRow
          icon="shield-outline"
          label="Privacy Policy"
          onPress={() =>
            openDialog({
              title: "Privacy Policy",
              copy: "You control whether your profile and eco stats can be shared. We protect your account data.",
              confirm: "Done",
            })
          }
        />
      </Group>
    </>
  );
}
function SwipeBlockRow({ children, onBlock }: { children: ReactNode; onBlock: () => void }) {
  const offset = useRef(new Animated.Value(0)).current;
  const [revealed, setRevealed] = useState(false);
  const animate = (value: number) => Animated.timing(offset, { toValue: value, duration: 180, useNativeDriver: true }).start();
  const pan = useMemo(() => PanResponder.create({ onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy), onPanResponderRelease: (_, gesture) => { const next = gesture.dx < -48; setRevealed(next); animate(next ? -76 : 0); } }), [offset]);
  return <View style={friendStyles.swipeContainer}><Pressable style={friendStyles.revealBlock} onPress={onBlock} accessibilityLabel="Block person"><Ionicons name="ban-outline" size={18} color={palette.cfff} /><Text style={friendStyles.revealBlockText}>Block</Text></Pressable><Animated.View {...pan.panHandlers} style={[friendStyles.swipeContent, { transform: [{ translateX: offset }] }]}>{children}</Animated.View></View>;
}

type SocialUserDto = { id: string; name: string; profile_picture_url?: string | null };
type SocialProfileDto = { id: string; name: string; profile_picture_url?: string; member_since: string; details_visible: boolean; relationship: string; mutual_friends: number; mutual_friend_users: SocialUserDto[]; bio?: string; dietary_restrictions?: string[]; allergies?: string[]; food_dislikes?: string[]; food_saved_kg?: number; eco_points?: number; recipes?: number };
type ProfileAction = "request" | "accept" | "cancel" | "ignore" | "remove" | "block" | "unblock";
function Friends({ api, openDialog, page, onPageChange, groupMode = false, currentUserId, currentUserAvatar, refreshSignal, onRefreshDone }: { api: ReturnType<typeof createMobileApi>; openDialog: (dialog: Dialog) => void; page: "friends" | "blocked" | "profile"; onPageChange: (page: "friends" | "blocked" | "profile") => void; groupMode?: boolean; currentUserId?: string; currentUserAvatar?: string | null; refreshSignal: number; onRefreshDone: (refreshing: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [requests, setRequests] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [friends, setFriends] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<Record<string, string>>({});
  const [userPictures, setUserPictures] = useState<Record<string, string | null>>({});
  const [groupMemberStatuses, setGroupMemberStatuses] = useState<Record<string, "active" | "pending">>({});
  const [cookingGroups,setCookingGroups] = useState<CookingGroup[]>([]);
  const [groupBusy,setGroupBusy] = useState(false);
  const [groupError,setGroupError] = useState<string>();
  const [editingGroup, setEditingGroup] = useState<CookingGroup>();
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupNameSaving, setGroupNameSaving] = useState(false);
  const [groupNameError, setGroupNameError] = useState<string>();
  const refreshCookingGroups = async () => {
    const result=await api.getMyCookingGroups<CookingGroupList>();setCookingGroups(result.items);
    const statuses=Object.fromEntries(result.items.filter(group=>group.is_owner).flatMap(group=>group.members.map(member=>[member.id,member.status] as const)));
    setGroupMemberStatuses(statuses);setGroupError(undefined);
  };
  const changeCookingGroup = async (action:()=>Promise<void>) => {
    if(groupBusy)return;setGroupBusy(true);setGroupError(undefined);
    try {await action();await refreshCookingGroups();} catch(error){setGroupError(error instanceof Error?error.message:"Group could not be updated. Try again.");}finally{setGroupBusy(false);}
  };
  const [selectedUser, setSelectedUser] = useState<SocialUserDto | null>(null);
  const [socialProfile, setSocialProfile] = useState<SocialProfileDto | null>(null);
  useEffect(() => {
    let active = true;
    const social = api.getMySocial<{ requests: SocialUserDto[]; pending: SocialUserDto[]; friends: SocialUserDto[]; suggestions: SocialUserDto[]; blocked: SocialUserDto[] }>().then((state) => {
      if (!active) return;
      const people = [...state.requests, ...state.pending, ...state.friends, ...state.suggestions, ...state.blocked];
      setUserIds(Object.fromEntries(people.map(item => [item.name, item.id])));
      setUserPictures(Object.fromEntries(people.map(item => [item.name, item.profile_picture_url ?? null])));
      setRequests(state.requests.map(item => item.name));
      setPending(state.pending.map(item => item.name));
      setFriends(state.friends.map(item => item.name));
      setSuggestions(state.suggestions.map(item => item.name));
      setBlocked(state.blocked.map(item => item.name));
    });
    const groups = refreshCookingGroups().catch(() => { if (active) setGroupError("Groups could not be loaded. Please try again."); });
    void Promise.allSettled([social, groups]).then(() => { if (active) onRefreshDone(false); });
    return () => { active = false; };
  }, [api, refreshSignal]);
  useEffect(() => { if (page === "profile" && selectedUser) { setSocialProfile(null); void api.getSocialProfile<SocialProfileDto>(selectedUser.id).then(setSocialProfile).catch(() => undefined); } }, [api, page, selectedUser]);
  const viewProfile = (name: string) => { const id = userIds[name]; if (!id) return; setSelectedUser({ id, name }); onPageChange("profile"); };
  const performProfileAction = async (action: ProfileAction) => {
    if (!selectedUser) return;
    if (action === "request" || action === "accept" || action === "block") await api.socialAction(selectedUser.id, action);
    else if (action === "unblock") await api.unblockSocialUser(selectedUser.id);
    else await api.removeSocialRelationship(selectedUser.id);
    if (action === "request") { setPending((items) => [...new Set([...items, selectedUser.name])]); setSuggestions((items) => items.filter((item) => item !== selectedUser.name)); }
    if (action === "accept") { setRequests((items) => items.filter((item) => item !== selectedUser.name)); setFriends((items) => [...new Set([...items, selectedUser.name])]); }
    if (action === "cancel") setPending((items) => items.filter((item) => item !== selectedUser.name));
    if (action === "ignore") setRequests((items) => items.filter((item) => item !== selectedUser.name));
    if (action === "remove") { setFriends((items) => items.filter((item) => item !== selectedUser.name)); setSuggestions((items) => [...new Set([...items, selectedUser.name])]); }
    if (action === "block") { setBlocked((items) => [...new Set([...items, selectedUser.name])]); setRequests((items) => items.filter((item) => item !== selectedUser.name)); setPending((items) => items.filter((item) => item !== selectedUser.name)); setFriends((items) => items.filter((item) => item !== selectedUser.name)); setSuggestions((items) => items.filter((item) => item !== selectedUser.name)); }
    if (action === "unblock") { setBlocked((items) => items.filter((item) => item !== selectedUser.name)); setSuggestions((items) => [...new Set([...items, selectedUser.name])]); }
    const updated = await api.getSocialProfile<SocialProfileDto>(selectedUser.id);
    setSocialProfile(updated);
  };
  const requestProfileAction = (action: ProfileAction) => {
    if (!selectedUser) return;
    const destructive = action === "block" || action === "remove";
    const needsConfirmation = destructive || action === "unblock";
    if (!needsConfirmation) { void performProfileAction(action); return; }
    const labels = action === "block" ? { title: `Block ${selectedUser.name}?`, copy: "They will be removed from your friends and requests, and will not be able to find your profile.", confirm: "Block person" } : action === "remove" ? { title: `Remove ${selectedUser.name}?`, copy: "They will no longer appear in your friends list. You can send another request later.", confirm: "Remove friend" } : { title: `Unblock ${selectedUser.name}?`, copy: "They will be able to find your profile and send friend requests again.", confirm: "Unblock" };
    openDialog({ ...labels, destructive, onConfirm: () => performProfileAction(action) });
  };
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const pictureFor = (name: string) => userPictures[name];
  const initialsFor = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const hostedGroup = cookingGroups.find((group) => group.is_owner && group.status === "active");
  const canInviteToOwnGroup = Boolean(hostedGroup) || !cookingGroups.some((group) => group.status === "active");
  const incomingGroupInvites = cookingGroups.filter((group) => !group.is_owner && group.status === "pending");
  const outgoingGroupInvites = cookingGroups.filter((group) => group.is_owner).flatMap((group) => group.members.filter((member) => member.status === "pending").map((member) => ({ ...member, groupId: group.id })));
  const toggleGroupMember = (name: string) => {
    const id=userIds[name];if(!id)return;
    const status=groupMemberStatuses[id];
    if (!status) { if (!canInviteToOwnGroup) return; void changeCookingGroup(()=>hostedGroup ? api.inviteMemberToCookingGroup(hostedGroup.id,id) : api.inviteCookingMember(id)); return; }
    openDialog({
      title: status === "pending" ? `Cancel ${name}’s group invite?` : `Remove ${name} from your cooking group?`,
      copy: status === "pending" ? "They will no longer have a request to join your cooking group. You can invite them again later." : "They will leave your cooking group, but remain your friend.",
      confirm: status === "pending" ? "Cancel invite" : "Remove from group",
      destructive: true,
      onConfirm: () => changeCookingGroup(()=>api.removeCookingMember(id)),
    });
  };
  const block = (name: string) =>
    openDialog({
      title: `Block ${name}?`,
      copy: "They will not be able to send you a request or find your profile until you unblock them.",
      confirm: "Block person",
      destructive: true,
      onConfirm: async () => {
        const id = userIds[name];
        if (id) await api.socialAction(id, "block");
        setBlocked((items) => [...items, name]);
        setRequests((items) => items.filter((item) => item !== name));
        setPending((items) => items.filter((item) => item !== name));
        setFriends((items) => items.filter((item) => item !== name));
        setSuggestions((items) => items.filter((item) => item !== name));
      },
    });
  const IconAction = ({
    icon,
    label,
    danger,
    onPress,
  }: {
    icon: Icon;
    label: string;
    danger?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      style={[friendStyles.iconAction, danger && friendStyles.blockAction]}
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Ionicons name={icon} size={18} color={danger ? palette.cd46a72 : palette.cfff} />
    </Pressable>
  );
  if (page === "profile") return <SocialProfileView profile={socialProfile} fallbackName={selectedUser?.name ?? "User"} onAction={requestProfileAction} />;
  if (page === "blocked") return <>{blocked.length ? <Group label="BLOCKED PEOPLE">{blocked.map((name) => <Person key={name} initials={name.split(" ").map((part) => part[0]).join("")} name={name} detail="Blocked" onPress={() => viewProfile(name)} actions={<Pressable style={styles.personAction} onPress={() => openDialog({ title: `Unblock ${name}?`, copy: "They will be able to find your profile and send a new friend request again.", confirm: "Unblock", onConfirm: async () => { const id = userIds[name]; if (id) await api.unblockSocialUser(id); setBlocked((items) => items.filter((item) => item !== name)); } })}><Text style={styles.personActionText}>Unblock</Text></Pressable>} />)}</Group> : <Text style={extraStyles.emptyText}>You have not blocked anyone.</Text>}</>;
  return (
    <>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={palette.ca4afab} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by name" placeholderTextColor={palette.ca8b0b8} style={extraStyles.searchInput} />
      </View>
      <Text style={friendStyles.swipeHint}>Swipe left on a person to reveal Block.</Text>
      {groupMode && <>
        <Text style={styles.groupLabel}>COOKING GROUPS</Text>
        {groupError ? <Pressable onPress={()=>void changeCookingGroup(async()=>{})}><Text style={extraStyles.emptyText}>{groupError} Tap to retry.</Text></Pressable> : null}
        {cookingGroups.filter(group=>group.status==="active").map(group=><CookingGroupCard key={group.id} group={group} currentUserId={currentUserId} currentUserAvatar={currentUserAvatar} onEdit={group.is_owner ? ()=>{setEditingGroup(group);setGroupNameDraft(group.name);setGroupNameError(undefined);} : undefined} onRemoveMember={group.is_owner ? (id,name)=>openDialog({title:`Remove ${name} from your cooking group?`,copy:"They will leave your cooking group, but remain your friend.",confirm:"Remove from group",destructive:true,onConfirm:()=>changeCookingGroup(()=>api.removeCookingMember(id))}) : undefined} onLeave={!group.is_owner ? ()=>openDialog({title:"Leave cooking group?",copy:"Shared schedules from this group will no longer appear in your plan.",confirm:"Leave group",destructive:true,onConfirm:()=>changeCookingGroup(()=>api.leaveCookingGroup(group.id))}) : undefined}/>)}
        {!cookingGroups.some(group=>group.status==="active") && !groupError ? <Text style={extraStyles.emptyText}>Invite a friend below to form your cooking group. They must join before receiving shared schedules.</Text> : null}
      </>}

      {false && blocked.length > 0 && (
        <Pressable
          style={extraStyles.blockedLink}
          onPress={() =>
            openDialog({
              title: "Blocked people",
              copy: `${blocked.join(", ")}. Use the button below to restore their access.`,
              confirm: "Unblock all",
              onConfirm: () => setBlocked([]),
            })
          }
        >
          <Ionicons name="ban-outline" size={17} color={palette.cf0525f} />
          <Text style={extraStyles.blockedLinkText}>
            Blocked people ({blocked.length})
          </Text>
        </Pressable>
      )}
      {requests.filter(matches).length || pending.filter(matches).length ? (
        <Group label="FRIEND REQUESTS">
          {requests.filter(matches).map((name) => (
            <SwipeBlockRow key={name} onBlock={() => block(name)}>
            <Person
              key={name}
              initials={initialsFor(name)}
              name={name}
              onPress={() => viewProfile(name)}
              detail="Friend request received"
              pending
              pictureUrl={pictureFor(name)}
              actions={
                <>
                  <Pressable
                    style={extraStyles.ignoreAction}
                    onPress={() => { const id = userIds[name]; void (id ? api.removeSocialRelationship(id) : Promise.resolve()); setRequests((items) => items.filter((item) => item !== name)); }}
                  >
                    <Text style={extraStyles.ignoreText}>Ignore</Text>
                  </Pressable>
                  <Pressable
                    style={styles.personAction}
                    onPress={() => { const id = userIds[name]; void (id ? api.socialAction(id, "accept") : Promise.resolve()); setRequests((items) => items.filter((item) => item !== name)); setFriends((items) => [...items, name]); }}
                  >
                    <Text style={styles.personActionText}>Accept</Text>
                  </Pressable>
                </>
              }
            />
            </SwipeBlockRow>
          ))}
        {pending.filter(matches).map((name) => (
          <SwipeBlockRow key={name} onBlock={() => block(name)}>
          <Person
            initials={initialsFor(name)}
            name={name}
            onPress={() => viewProfile(name)}
            detail="Friend request sent"
            pending
            pictureUrl={pictureFor(name)}
            actions={
              <Pressable
                style={extraStyles.ignoreAction}
                onPress={() => { const id = userIds[name]; void (id ? api.removeSocialRelationship(id) : Promise.resolve()); setPending((items) => items.filter((item) => item !== name)); }}
              >
                <Text style={extraStyles.ignoreText}>Cancel</Text>
              </Pressable>
            }
          />
          </SwipeBlockRow>
        ))}
        </Group>
      ) : (
        <>
          <Text style={styles.groupLabel}>FRIEND REQUESTS</Text>
          <Text style={extraStyles.emptyText}>No friend requests</Text>
        </>
      )}
      <Group label="PENDING GROUP INVITES">
        {incomingGroupInvites.filter((group) => matches(group.owner_name)).map((group) => (
          <SwipeBlockRow key={`group-received-${group.id}`} onBlock={() => block(group.owner_name)}>
            <Person initials={initialsFor(group.owner_name)} name={group.owner_name}
              detail="Cooking group invitation received" pending pictureUrl={pictureFor(group.owner_name)}
              onPress={() => viewProfile(group.owner_name)} actions={<View style={extraStyles.personActions}>
                <Pressable disabled={groupBusy} style={extraStyles.groupInviteDecline} onPress={() => openDialog({ title: `Decline ${group.owner_name}’s group invite?`, copy: "You can be invited again later.", confirm: "Decline invite", destructive: true, onConfirm: () => changeCookingGroup(() => api.leaveCookingGroup(group.id)) })} accessibilityLabel={`Decline ${group.owner_name}’s group invite`}><Ionicons name="close" size={19} color={palette.cd9505b} /></Pressable>
                <Pressable disabled={groupBusy} style={styles.personAction} onPress={() => void changeCookingGroup(() => api.joinCookingGroup(group.id))}><Text style={styles.personActionText}>Join group</Text></Pressable>
              </View>} />
          </SwipeBlockRow>
        ))}
        {outgoingGroupInvites.filter((member) => matches(member.name)).map((member) => (
          <SwipeBlockRow key={`group-sent-${member.groupId}-${member.id}`} onBlock={() => block(member.name)}>
            <Person initials={initialsFor(member.name)} name={member.name}
              detail="Cooking group invitation sent" pending pictureUrl={pictureFor(member.name)}
              onPress={() => viewProfile(member.name)} actions={<Pressable disabled={groupBusy} style={extraStyles.groupInviteDecline} onPress={() => toggleGroupMember(member.name)} accessibilityLabel={`Cancel ${member.name}’s group invite`}><Ionicons name="close" size={19} color={palette.cd9505b} /></Pressable>} />
          </SwipeBlockRow>
        ))}
      </Group>
      <Group label="CURRENT FRIENDS">
        {friends.filter(matches).map((name) => {
          const userId = userIds[name];
          const groupStatus = userId ? groupMemberStatuses[userId] : undefined;
          if (groupMode && groupStatus === "pending") return null;
          return <SwipeBlockRow key={name} onBlock={() => block(name)}><Person initials={initialsFor(name)} name={name} detail={groupMode ? groupStatus === "active" ? "Cooking group member" : "Friend · Not in group" : "Friends since 2024"} pictureUrl={pictureFor(name)} onPress={() => viewProfile(name)} actions={groupMode ? groupStatus === "active" ? <Text style={extraStyles.cookingGroupMemberBadge}>In group</Text> : canInviteToOwnGroup ? <Pressable style={extraStyles.groupMemberAction} disabled={groupBusy} onPress={() => toggleGroupMember(name)}><Ionicons name="person-add-outline" size={16} color={palette.cffffff} /><Text style={extraStyles.groupMemberActionText}>Invite to group</Text></Pressable> : undefined : <IconAction icon="person-remove-outline" label={`Remove ${name} as a friend`} danger onPress={() => openDialog({ title: `Remove ${name}?`, copy: "They will no longer appear in your friends list. You can send a new request later.", confirm: "Remove friend", destructive: true, onConfirm: async () => { const id = userIds[name]; if (id) await api.removeSocialRelationship(id); setFriends((items) => items.filter((item) => item !== name)); } })} />} /></SwipeBlockRow>;
        })}
      </Group>
      <Group label="PEOPLE YOU MAY KNOW">
        {suggestions.filter(matches).map((name, index) => (
          <SwipeBlockRow key={name} onBlock={() => block(name)}>
          <Person
            initials={initialsFor(name)}
            name={name}
            onPress={() => viewProfile(name)}
            pictureUrl={pictureFor(name)}
            suggested
            detail={
              index
                ? "4 mutual friends · 2,860 pts"
                : "3 mutual friends · 1,750 pts"
            }
            actions={
              <>
                <IconAction
                  icon="person-add-outline"
                  label={`Send request to ${name}`}
                  onPress={() => {
                    const id = userIds[name];
                    if (id) void api.socialAction(id, "request");
                    setPending((items) => [...items, name]);
                    setSuggestions((items) =>
                      items.filter((item) => item !== name),
                    );
                  }}
                />
              </>
            }
          />
          </SwipeBlockRow>
        ))}
      </Group>
      <Modal visible={editingGroup!==undefined} transparent animationType="fade" onRequestClose={()=>setEditingGroup(undefined)}>
        <View style={styles.modalOverlay}><View style={extraStyles.groupNameDialog}>
          <Text style={extraStyles.cookingGroupTitle}>Edit cooking group name</Text>
          <Text style={styles.helper}>Choose a name that members will see.</Text>
          <TextInput value={groupNameDraft} onChangeText={setGroupNameDraft} maxLength={100} autoFocus style={extraStyles.groupNameInput} placeholder="Cooking group name" placeholderTextColor={colors.textSubtle}/>
          {groupNameError && <Text style={extraStyles.groupNameError}>{groupNameError}</Text>}
          <View style={extraStyles.groupNameActions}>
            <Pressable disabled={groupNameSaving} style={extraStyles.groupNameCancel} onPress={()=>setEditingGroup(undefined)}><Text style={extraStyles.groupNameCancelText}>Cancel</Text></Pressable>
            <Pressable disabled={groupNameSaving} style={extraStyles.groupNameSave} onPress={()=>{const name=groupNameDraft.trim();if(!name){setGroupNameError("Enter a group name.");return;}if(!editingGroup)return;setGroupNameSaving(true);void api.renameCookingGroup(editingGroup.id,name).then(refreshCookingGroups).then(()=>setEditingGroup(undefined)).catch(error=>setGroupNameError(error instanceof Error?error.message:"Could not rename the group.")).finally(()=>setGroupNameSaving(false));}}><Text style={extraStyles.groupNameSaveText}>{groupNameSaving?"Saving…":"Save name"}</Text></Pressable>
          </View>
        </View></View>
      </Modal>
      {blocked.length > 0 && <Pressable style={extraStyles.blockedLink} onPress={() => onPageChange("blocked")}><Ionicons name="ban-outline" size={17} color={palette.cf0525f} /><Text style={extraStyles.blockedLinkText}>Blocked people ({blocked.length})</Text></Pressable>}
    </>
  );
}
function CookingGroupCard({ group, currentUserId, currentUserAvatar, onLeave, onEdit, onRemoveMember }: { group: CookingGroup; currentUserId?: string; currentUserAvatar?: string | null; onLeave?: () => void; onEdit?: () => void; onRemoveMember?: (id: string, name: string) => void }) {
  const members = group.members.filter(member=>member.status==="active");
  return <View style={extraStyles.cookingGroupCard}>
    <View style={extraStyles.cookingGroupHead}><View style={extraStyles.cookingGroupHeadCopy}><Text style={extraStyles.cookingGroupTitle}>{group.name}</Text><Text style={extraStyles.cookingGroupSubtitle}>Created by {group.owner_id===currentUserId ? "You" : group.owner_name}</Text></View>{onEdit && <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${group.name} name`} style={({hovered,pressed})=>[extraStyles.cookingGroupEdit,hovered&&extraStyles.cookingGroupEditHover,pressed&&extraStyles.cookingGroupEditPressed]} onPress={onEdit}><Ionicons name="create-outline" size={19} color={colors.primaryStrong}/></Pressable>}</View>
    <Text style={extraStyles.cookingGroupMembersLabel}>MEMBERS</Text>
    {members.map(member=>{
      const isYou=member.id===currentUserId;
      const picture=isYou ? currentUserAvatar || member.profile_picture_url : member.profile_picture_url;
      return <View key={member.id} style={extraStyles.cookingGroupMemberRow}>
        <View style={extraStyles.cookingGroupAvatar}>{picture ? <Image source={{uri:picture}} style={extraStyles.cookingGroupAvatarImage}/> : <Ionicons name="person" size={17} color={colors.primaryStrong}/>}</View>
        <Text style={extraStyles.cookingGroupMemberName}>{isYou ? "You" : member.name}</Text>
        {member.id===group.owner_id && <Text style={extraStyles.cookingGroupOwnerBadge}>Owner</Text>}
        {onRemoveMember && member.id!==group.owner_id && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${member.name} from group`} style={extraStyles.cookingGroupRemove} onPress={()=>onRemoveMember(member.id,member.name)}><Ionicons name="close" size={19} color={colors.danger}/></Pressable>}
      </View>;
    })}
    {onLeave && <Pressable style={extraStyles.cookingGroupLeave} onPress={onLeave}><Ionicons name="exit-outline" size={16} color={colors.danger}/><Text style={extraStyles.cookingGroupLeaveText}>Leave group</Text></Pressable>}
  </View>;
}
function SocialProfileView({ profile, fallbackName, onAction }: { profile: SocialProfileDto | null; fallbackName: string; onAction: (action: ProfileAction) => void }) {
  if (!profile) return <View style={extraStyles.socialProfileLoading}><ActivityIndicator color={palette.c16a45b} /><Text style={styles.helper}>Loading {fallbackName}’s profile…</Text></View>;
  const memberSince = new Date(profile.member_since).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return <View style={extraStyles.socialProfileCard}>
    <View style={extraStyles.socialProfileAvatar}>
      {profile.profile_picture_url ? <Image source={{ uri: profile.profile_picture_url }} style={extraStyles.socialProfileImage} /> : <Ionicons name="person" size={68} color={palette.c9aa3af} />}
    </View>
    <Text style={extraStyles.socialProfileName}>{profile.name}</Text>
    <Text style={styles.helper}>EcoChef member since {memberSince}</Text>
    <View style={extraStyles.relationshipPills}>
      <View style={extraStyles.relationshipPill}><Ionicons name="people-outline" size={15} color={palette.c168e51} /><Text style={extraStyles.relationshipText}>{profile.relationship.replaceAll("_", " ")}</Text></View>
      <View style={extraStyles.relationshipPill}><Text style={extraStyles.relationshipText}>{profile.mutual_friends} mutual friends</Text></View>
    </View>
    {profile.mutual_friend_users.length > 0 && <View style={extraStyles.mutualSection}>
      <Text style={styles.formHeading}>Mutual friends</Text>
      {profile.mutual_friend_users.map((friend) => <View key={friend.id} style={extraStyles.mutualFriendRow}><View style={styles.personAvatar}><Text style={styles.personInitials}>{friend.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</Text></View><Text style={styles.rowText}>{friend.name}</Text></View>)}
    </View>}
    {!profile.details_visible ? <View style={extraStyles.privateNotice}><Ionicons name="lock-closed-outline" size={22} color={palette.c788595} /><Text style={extraStyles.privateTitle}>Profile details are private</Text><Text style={styles.helper}>This user’s visibility settings only allow you to see their basic profile.</Text></View> : <>
      {!!profile.bio && <View style={extraStyles.profileDetailSection}><Text style={styles.formHeading}>About</Text><Text style={extraStyles.profileBio}>{profile.bio}</Text></View>}
      <View style={styles.metrics}>
        <Metric icon="leaf-outline" value={`${profile.food_saved_kg ?? 0}kg`} label="FOOD SAVED" color={palette.c14a957} tint={palette.ceafaf0} />
        <Metric icon="flame-outline" value={`${profile.eco_points ?? 0}`} label="ECO POINTS" color={palette.cf37a20} tint={palette.cfff3e7} />
        <Metric icon="restaurant-outline" value={`${profile.recipes ?? 0}`} label="RECIPES" color={palette.c3478f6} tint={palette.cecf4ff} />
      </View>
      <ProfileTags title="Preferences" items={profile.dietary_restrictions ?? []} color={palette.c168e51} background={palette.ce7f8ee} />
      <ProfileTags title="Allergies" items={profile.allergies ?? []} color={palette.cd74d59} background={palette.cfff0f1} />
      <ProfileTags title="Food dislikes" items={profile.food_dislikes ?? []} color={palette.ce87520} background={palette.cfff1e6} />
    </>}
    <View style={extraStyles.profileActions}>
      {profile.relationship === "none" && <ProfileActionButton icon="person-add-outline" label="Send friend request" onPress={() => onAction("request")} />}
      {profile.relationship === "request_sent" && <ProfileActionButton icon="close-circle-outline" label="Cancel request" onPress={() => onAction("cancel")} />}
      {profile.relationship === "request_received" && <><ProfileActionButton icon="checkmark-circle-outline" label="Accept request" onPress={() => onAction("accept")} /><ProfileActionButton icon="close-circle-outline" label="Ignore request" secondary onPress={() => onAction("ignore")} /></>}
      {profile.relationship === "friends" && <ProfileActionButton icon="person-remove-outline" label="Remove friend" danger onPress={() => onAction("remove")} />}
      {profile.relationship === "blocked" ? <ProfileActionButton icon="lock-open-outline" label="Unblock user" onPress={() => onAction("unblock")} /> : <ProfileActionButton icon="ban-outline" label="Block user" danger secondary onPress={() => onAction("block")} />}
    </View>
  </View>;
}

function ProfileActionButton({ icon, label, onPress, danger, secondary }: { icon: Icon; label: string; onPress: () => void; danger?: boolean; secondary?: boolean }) {
  return <Pressable style={[extraStyles.profileActionButton, secondary && extraStyles.profileActionSecondary, danger && extraStyles.profileActionDanger]} onPress={onPress}><Ionicons name={icon} size={18} color={danger ? palette.cd9505b : secondary ? palette.c526271 : palette.cffffff} /><Text style={[extraStyles.profileActionText, secondary && extraStyles.profileActionSecondaryText, danger && extraStyles.profileActionDangerText]}>{label}</Text></Pressable>;
}

function ProfileTags({ title, items, color, background }: { title: string; items: string[]; color: string; background: string }) {
  return <View style={extraStyles.profileDetailSection}><Text style={styles.formHeading}>{title}</Text>{items.length ? <View style={styles.chips}>{items.map((item) => <View key={item} style={[extraStyles.summaryChip, { backgroundColor: background }]}><Text style={{ color, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold }}>{item}</Text></View>)}</View> : <Text style={styles.helper}>No data yet.</Text>}</View>;
}

function Person({
  initials,
  name,
  detail,
  pending,
  suggested,
  pictureUrl,
  actions,
  onPress,
}: {
  initials: string;
  name: string;
  detail: string;
  pending?: boolean;
  suggested?: boolean;
  pictureUrl?: string | null;
  actions?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <View style={styles.person}>
      <Pressable style={extraStyles.personProfileLink} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={onPress ? `View ${name}'s profile` : undefined}>
        <View style={[styles.personAvatar, pending && styles.pendingAvatar, suggested && styles.suggestedAvatar]}>
          {pictureUrl ? <Image source={{ uri: pictureUrl }} style={styles.personAvatarImage} /> : <Text style={[styles.personInitials, pending && styles.pendingText, suggested && styles.suggestedText]}>{initials}</Text>}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowText}>{name}</Text>
          <Text style={styles.rowCaption}>{detail}</Text>
        </View>
      </Pressable>
      {actions && <View style={extraStyles.personActions}>{actions}</View>}
    </View>
  );
}
type PurchaseOrderDto = { id: string; shop: string; order_date: string; status: string; total_amount: string; items: { name: string; quantity: number; unit_price: string }[] };
const purchaseStatusDisplay = (status: string) => {
  switch (status.toLowerCase()) {
    case "pending_payment":
    case "pending": return { label: "Order received", color: colors.warningStrong, backgroundColor: colors.warningSoft };
    case "placed": return { label: "Order confirmed", color: colors.adminStrong, backgroundColor: colors.adminSoft };
    case "preparing": return { label: "Being prepared", color: colors.marketStrong, backgroundColor: colors.marketSoft };
    case "ready": return { label: "Ready for handover", color: colors.marketStrong, backgroundColor: colors.marketSoft };
    case "completed":
    case "delivered": return { label: "Completed", color: colors.success, backgroundColor: colors.successSoft };
    case "cancelled":
    case "failed": return { label: status.toLowerCase() === "failed" ? "Payment failed" : "Cancelled", color: colors.danger, backgroundColor: colors.dangerSoft };
    case "refunded": return { label: "Refunded", color: colors.adminStrong, backgroundColor: colors.adminSoft };
    default: return { label: status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), color: colors.textMuted, backgroundColor: colors.surfaceMuted };
  }
};
function Purchases({ api }: { api: ReturnType<typeof createMobileApi> }) {
  const [orders, setOrders] = useState<PurchaseOrderDto[]>([]);
  const [totalSpend, setTotalSpend] = useState("0.00");
  const [transactionCount, setTransactionCount] = useState(0);
  const [expanded, setExpanded] = useState("");
  useEffect(() => { void api.getPurchaseHistory<{ total_spend: string; transaction_count: number; orders: PurchaseOrderDto[] }>().then((history) => { setOrders(history.orders); setTotalSpend(history.total_spend); setTransactionCount(history.transaction_count); }).catch(() => undefined); }, [api]);
  const toggle = (shop: string) => {
    if (
      Platform.OS === "android" &&
      UIManager.setLayoutAnimationEnabledExperimental
    )
      UIManager.setLayoutAnimationEnabledExperimental(true);
    LayoutAnimation.configureNext({
      duration: 380,
      create: { type: "easeInEaseOut", property: "scaleY" },
      update: { type: "easeInEaseOut" },
      delete: { type: "easeInEaseOut", property: "scaleY" },
    });
    setExpanded(expanded === shop ? "" : shop);
  };
  return (
    <>
      <View style={styles.purchaseMetrics}>
        <View style={[styles.spendMetric, purchaseStyles.summaryShadow]}>
          <Ionicons name="wallet-outline" size={22} color={palette.cfff} />
          <Text style={[styles.metricLabel, { color: palette.cd9f5e4 }]}>
            TOTAL SPEND
          </Text>
          <Text style={[styles.spendValue, { color: palette.cfff }]}>RM {Number(totalSpend).toFixed(2)}</Text>
        </View>
        <View style={[styles.transactionMetric, purchaseStyles.summaryShadow]}>
          <Ionicons name="reload-outline" size={22} color={palette.c1c2d42} />
          <Text style={styles.metricLabel}>TOTAL TRANSACTION</Text>
          <Text style={styles.spendValue}>{transactionCount}</Text>
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push("/marketplace/reviews" as never)}><Text style={[styles.groupLabel, { color: colors.primaryStrong }]}>RATE PURCHASED ITEMS</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/reports" as never)}><Text style={[styles.groupLabel, { color: colors.primaryStrong }]}>YOUR REPORTS & OUTCOMES</Text></Pressable>
      <Text style={styles.groupLabel}>RECENT ORDERS</Text>
      {orders.length === 0 && (
        <Text style={extraStyles.emptyText}>No transaction yet</Text>
      )}
      {orders.map((order) => {
        const status = purchaseStatusDisplay(order.status);
        const isExpanded = expanded === order.id;
        return <View style={styles.orderCard} key={order.id}>
          <Pressable
            style={styles.orderHeader}
            onPress={() => toggle(order.id)}
            accessibilityLabel={`${isExpanded ? "Hide" : "Show"} details for ${order.shop}`}
            accessibilityState={{ expanded: isExpanded }}
          >
            <View>
              <Text style={styles.addressName}>{order.shop}</Text>
              <Text style={styles.rowCaption}>{new Date(order.order_date).toLocaleDateString()} · #{order.id.slice(0, 8).toUpperCase()}</Text>
            </View>
            <View style={extraStyles.orderControls}>
              <Text
                style={[
                  styles.status,
                  { color: status.color, backgroundColor: status.backgroundColor },
                ]}
              >
                {status.label}
              </Text>
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={palette.c8a98a4}
              />
            </View>
          </Pressable>
          {isExpanded && (
            <View style={[extraStyles.lineItems, purchaseStyles.roomyLineItems]}>
              {order.items.map((item) => (
                <View
                  style={[extraStyles.lineItem, purchaseStyles.roomyLineItem]}
                  key={item.name}
                >
                  <Text style={styles.rowText}>{item.name} × {item.quantity}</Text>
                  <Text style={styles.rowText}>RM {(Number(item.unit_price) * item.quantity).toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.orderTotal}>
            <Text style={styles.rowCaption}>Order total</Text>
            <Text style={styles.addressName}>RM {Number(order.total_amount).toFixed(2)}</Text>
          </View>
        </View>;
      })}
    </>
  );
}
type PromoDto = { id: string; code: string; title: string; description: string; audience: "available" | "new_account" | "gift"; end_date: string };
function Promos({ api }: { api: ReturnType<typeof createMobileApi> }) {
  const [promos, setPromos] = useState<PromoDto[]>([]);
  const [loadingPromos, setLoadingPromos] = useState(true);
  useEffect(() => { setLoadingPromos(true); void api.getMyPromos<{ promos: PromoDto[] }>().then((result) => setPromos(result.promos)).catch(() => setPromos([])).finally(() => setLoadingPromos(false)); }, [api]);
  if (loadingPromos) return <View style={extraStyles.socialProfileLoading}><ActivityIndicator color={palette.c3478f6} /><Text style={styles.helper}>Loading your promo codes…</Text></View>;
  if (!promos.length) return <Text style={extraStyles.emptyText}>No promo codes available yet.</Text>;
  return <>{promos.map((promo, index) => {
    const firstOfAudience = index === 0 || promos[index - 1].audience !== promo.audience;
    const audienceStyle = promo.audience === "available"
      ? { label: "AVAILABLE TO YOU", icon: "pricetag-outline" as Icon, accent: palette.c14a957, tint: palette.ceafaf0 }
      : promo.audience === "new_account"
        ? { label: "GIVEN TO NEW ACCOUNTS", icon: "person-add-outline" as Icon, accent: palette.c3478f6, tint: palette.ceaf3ff }
        : { label: "GIVEN TO YOU", icon: "gift-outline" as Icon, accent: palette.cf37a20, tint: palette.cfff2e9 };
    return <Promo key={promo.id} label={firstOfAudience ? audienceStyle.label : undefined} headingIcon={firstOfAudience ? audienceStyle.icon : undefined} title={promo.title} copy={promo.description} code={promo.code} expiry={`Ends ${new Date(promo.end_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`} tint={audienceStyle.tint} accent={audienceStyle.accent} />;
  })}</>;
}
function Promo({
  label,
  headingIcon,
  title,
  copy,
  code,
  expiry,
  tint,
  accent,
}: {
  label?: string;
  headingIcon?: Icon;
  title: string;
  copy: string;
  code: string;
  expiry: string;
  tint: string;
  accent: string;
}) {
  return (
    <>
      {label && (
        <View style={extraStyles.promoHeading}>
          <Ionicons name={headingIcon!} size={16} color={accent} />
          <Text
            style={[
              styles.groupLabel,
              { marginTop: 0, marginBottom: 0, lineHeight: 16 },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
      <View style={styles.promoCard}>
        <View
          style={[
            styles.promoIcon,
            { backgroundColor: tint, borderColor: accent },
          ]}
        >
          <Ionicons name="pricetag-outline" size={19} color={accent} />
        </View>
        <Text style={styles.promoTitle}>{title}</Text>
        <Text style={styles.promoCopy}>{copy}</Text>
        <Text style={styles.promoLabel}>PROMO CODE</Text>
        <View style={styles.promoFooter}>
          <View>
            <Text
              style={[
                styles.code,
                {
                  fontFamily: Platform.select(typography.monospace),
                  letterSpacing: 0.8,
                },
              ]}
            >
              {code}
            </Text>
            <Text style={[styles.rowCaption, { marginTop: 9 }]}>{expiry}</Text>
          </View>
          <Pressable style={styles.copyButton}>
            <Ionicons name="copy-outline" size={15} color={palette.cfff} />
            <Text style={styles.copyText}>Copy code</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}
const extraStyles = StyleSheet.create({
  flex: { flex: 1 },
  cookingGroupCard: { marginTop: 10, padding: 15, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
  cookingGroupHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cookingGroupHeadCopy: { flex: 1 },
  cookingGroupEdit: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: colors.surface, shadowColor: colors.text, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3 },
  cookingGroupEditHover: { borderColor: colors.primaryBorder, shadowOpacity: 0.2, shadowRadius: 9, elevation: 5, transform: [{ scale: 1.05 }] },
  cookingGroupEditPressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  cookingGroupTitle: { color: colors.text, fontSize: typography.mobile.rawSize.s15, fontWeight: typography.weight.extrabold },
  cookingGroupSubtitle: { marginTop: 3, color: colors.textMuted, fontSize: typography.mobile.rawSize.s10 },
  cookingGroupMembersLabel: { marginTop: 15, marginBottom: 4, color: colors.textSubtle, fontSize: typography.mobile.rawSize.s9, fontWeight: typography.weight.extrabold },
  cookingGroupMemberRow: { minHeight: 43, flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cookingGroupAvatar: { width: 29, height: 29, alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: 10, backgroundColor: colors.primarySoft },
  cookingGroupAvatarImage: { width: "100%", height: "100%" },
  cookingGroupMemberName: { flex: 1, color: colors.text, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  cookingGroupOwnerBadge: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  cookingGroupMemberBadge: { color: colors.primaryStrong, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  cookingGroupRemove: { width: 31, height: 31, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.cf2c8cc, borderRadius: 9, backgroundColor: colors.dangerSoft },
  cookingGroupLeave: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 39, marginTop: 11, borderWidth: 1, borderColor: palette.cf2c8cc, borderRadius: 11, backgroundColor: colors.dangerSoft },
  cookingGroupLeaveText: { color: colors.danger, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold },
  groupNameDialog: { width: "100%", maxWidth: 380, padding: 20, borderRadius: 19, backgroundColor: colors.surface },
  groupNameInput: { minHeight: 46, marginTop: 15, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 11, color: colors.text, backgroundColor: colors.surfaceMuted, fontSize: typography.mobile.rawSize.s13 },
  groupNameError: { marginTop: 7, color: colors.danger, fontSize: typography.mobile.rawSize.s11 },
  groupNameActions: { flexDirection: "row", gap: 9, marginTop: 16 },
  groupNameCancel: { flex: 1, minHeight: 43, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.surfaceMuted },
  groupNameCancelText: { color: colors.textMuted, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  groupNameSave: { flex: 1, minHeight: 43, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.primaryStrong },
  groupNameSaveText: { color: colors.surface, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  groupMemberAction: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 11, backgroundColor: palette.c16a45b },
  groupMemberActionText: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.extrabold },
  groupInviteDecline: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.cf2c8cc, borderRadius: 18, backgroundColor: palette.cfff1f2 },
  visibilityOptions: { gap: 8, marginTop: 10, marginBottom: 18 },
  visibilityOption: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderColor: palette.ce2e7e3, borderRadius: 12, backgroundColor: palette.cffffff },
  visibilitySelected: { borderColor: palette.c73d69a, backgroundColor: palette.ceffaf3 },
  visibilityLabel: { color: palette.c20372f, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  personProfileLink: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  socialProfileLoading: { alignItems: "center", gap: 10, paddingVertical: 60 },
  socialProfileCard: { alignItems: "center", padding: 18, borderWidth: 1, borderColor: palette.ce4e8e4, borderRadius: 20, backgroundColor: palette.cffffff },
  socialProfileAvatar: { width: 104, height: 104, alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: 28, backgroundColor: palette.ce5e8ed },
  socialProfileImage: { width: "100%", height: "100%" },
  socialProfileName: { marginTop: 13, color: palette.c13273a, fontSize: typography.mobile.rawSize.s22, fontWeight: typography.weight.extrabold },
  relationshipPills: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 14 },
  relationshipPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: palette.ceaf8ef },
  relationshipText: { color: palette.c287151, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold, textTransform: "capitalize" },
  mutualSection: { width: "100%", marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: palette.ce8ece9 },
  mutualFriendRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 9 },
  privateNotice: { width: "100%", alignItems: "center", marginTop: 24, padding: 20, borderRadius: 16, backgroundColor: palette.cf4f6f5 },
  privateTitle: { marginTop: 8, color: palette.c374756, fontSize: typography.mobile.rawSize.s15, fontWeight: typography.weight.bold },
  profileDetailSection: { width: "100%", marginTop: 20 },
  profileBio: { color: palette.c647383, fontSize: typography.mobile.rawSize.s13, lineHeight: 20 },
  profileActions: { width: "100%", gap: 9, marginTop: 22, paddingTop: 16, borderTopWidth: 1, borderTopColor: palette.ce8ece9 },
  profileActionButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, borderRadius: 13, backgroundColor: palette.c16a45b },
  profileActionSecondary: { borderWidth: 1, borderColor: palette.cdde4df, backgroundColor: palette.cf7f9f7 },
  profileActionDanger: { borderWidth: 1, borderColor: palette.cf2c8cc, backgroundColor: palette.cfff1f2 },
  profileActionText: { color: palette.cffffff, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.extrabold },
  profileActionSecondaryText: { color: palette.c526271 },
  profileActionDangerText: { color: palette.cd9505b },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  customInput: {
    flex: 1,
    minHeight: 43,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.ce1e5e0,
    borderRadius: 11,
    color: palette.c20372f,
    backgroundColor: palette.cfff,
  },
  addButton: {
    width: 43,
    height: 43,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: palette.c14a957,
  },
  searchInput: { flex: 1, color: palette.c20372f, fontSize: typography.mobile.rawSize.s12 },
  chipOrange: { borderColor: palette.cff8b1a, backgroundColor: palette.cff8b1a },
  summaryChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  blockedLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: palette.cfff1f2,
  },
  blockedLinkText: { color: palette.cd46a72, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  personActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  ignoreAction: { paddingHorizontal: 8, paddingVertical: 7 },
  ignoreText: { color: palette.c687681, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  emptyText: { padding: 14, color: palette.c97a3b2, fontSize: typography.mobile.rawSize.s12 },
  orderControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  lineItems: {
    gap: 7,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: palette.cf7f9f7,
  },
  lineItem: { flexDirection: "row", justifyContent: "space-between" },
  promoHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 19,
    marginBottom: 0,
  },
});
const purchaseStyles = StyleSheet.create({
  summaryShadow: {
    shadowColor: palette.c86d9a8,
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  roomyLineItems: { gap: 12, overflow: "hidden", paddingVertical: 14, paddingHorizontal: 12 },
  roomyLineItem: { minHeight: 25, alignItems: "center" },
});
const friendStyles = StyleSheet.create({
  blockedPageHeader: { display: "none" },
  blockedBack: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: palette.ceef1f0 },
  swipeHint: { marginTop: 8, color: palette.c8a98a4, fontSize: typography.mobile.rawSize.s11, textAlign: "center" },
  swipeContainer: { overflow: "hidden", position: "relative", width: "100%" },
  swipeContent: { width: "100%", backgroundColor: palette.cfff },
  revealBlock: { position: "absolute", right: 0, top: 0, bottom: 0, width: 84, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: palette.cd9505b },
  revealBlockText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  iconAction: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: palette.c14a957,
  },
  blockAction: {
    borderWidth: 1,
    borderColor: palette.cf7c9cd,
    backgroundColor: palette.cfff4f5,
  },
});

function SaveButton({
  saving,
  onPress,
  label = "Save changes",
}: {
  saving: boolean;
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      style={styles.saveButton}
      onPress={() => void onPress()}
      disabled={saving}
    >
      <Text style={styles.saveButtonText}>{saving ? "Saving…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.consumerCanvas },
  content: { padding: 16, paddingTop: 30, paddingBottom: 112 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: palette.cf8f6f1,
  },
  loadingText: { color: palette.c71827b },
  overviewHeading: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  overviewBack: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: palette.ceef1f0 },
  overviewTitle: {
    color: palette.c13273a,
    fontSize: typography.mobile.rawSize.s23,
    fontWeight: typography.weight.bold,
  },
  pageHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.ce1e4df,
    borderRadius: 11,
    backgroundColor: palette.cfff,
    shadowColor: palette.c263c34,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  pageTitle: { color: palette.c13273a, fontSize: typography.mobile.rawSize.s21, fontWeight: typography.weight.bold },
  pageSubtitle: { marginTop: 1, color: palette.c91a0ad, fontSize: typography.mobile.rawSize.s11 },
  saveTop: {
    marginLeft: "auto",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: palette.c14a957,
  },
  saveTopText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s12, fontWeight: typography.weight.bold },
  profileCard: {
    alignItems: "center",
    padding: 18,
    borderWidth: 1,
    borderColor: palette.ce8e6e1,
    borderRadius: 15,
    backgroundColor: palette.cfff,
    shadowColor: palette.c263c34,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  avatar: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: palette.ce5e8ed,
  },
  avatarPreviewButton: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%", borderRadius: 18 },
  avatarPreviewOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: palette.crgba_13_25_22_0_92,
  },
  avatarPreviewClose: {
    position: "absolute",
    top: 52,
    right: 24,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: palette.crgba_255_255_255_0_16,
  },
  avatarPreviewFrame: {
    width: 290,
    height: 290,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 3,
    borderColor: palette.cffffff,
    borderRadius: 30,
    backgroundColor: palette.ce5e8ed,
  },
  avatarPreviewImage: { width: "100%", height: "100%" },
  avatarPreviewName: { marginTop: 18, color: palette.cffffff, fontSize: typography.mobile.rawSize.s20, fontWeight: typography.weight.bold },
  avatarPreviewHint: { marginTop: 8, color: palette.cc9d3ce, fontSize: typography.mobile.rawSize.s12, textAlign: "center" },
  editBadge: {
    position: "absolute",
    right: -5,
    bottom: -5,
    width: 27,
    height: 27,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: palette.cfff,
    borderRadius: 14,
    backgroundColor: palette.cfb7a1c,
  },
  memberName: {
    marginTop: 10,
    color: palette.c13273a,
    fontSize: typography.mobile.rawSize.s17,
    fontWeight: typography.weight.bold,
  },
  memberCaption: { marginTop: 2, color: palette.c91a0ad, fontSize: typography.mobile.rawSize.s12 },
  metrics: { flexDirection: "row", width: "100%", gap: 8, marginTop: 16 },
  metric: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 11,
  },
  metricValue: { marginTop: 2, fontSize: typography.mobile.rawSize.s15, fontWeight: typography.weight.bold },
  metricLabel: {
    marginTop: 3,
    color: palette.c85929b,
    fontSize: typography.mobile.rawSize.s8,
    fontWeight: typography.weight.bold,
  },
  groupLabel: {
    marginTop: 19,
    marginBottom: 8,
    color: palette.c98a4b0,
    fontSize: typography.mobile.rawSize.s10,
    fontWeight: typography.weight.bold,
    letterSpacing: 0.7,
  },
  dangerLabel: { color: palette.cd9989f },
  list: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.ce5e6e1,
    borderRadius: 14,
    backgroundColor: palette.cfff,
    shadowColor: palette.c263c34,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  dangerList: { borderColor: palette.cffd4d7 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.cebece8,
  },
  rowBody: { flex: 1 },
  rowText: { color: palette.c273a4e, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.semibold },
  rowCaption: { marginTop: 2, color: palette.c97a3b2, fontSize: typography.mobile.rawSize.s10 },
  dangerText: { color: palette.cf0525f },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 47,
    marginTop: 22,
    borderWidth: 1,
    borderColor: palette.cffd8d9,
    borderRadius: 13,
    backgroundColor: palette.cfff4f4,
  },
  logoutText: { color: palette.cf0525f, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold },
  message: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: palette.ce8f8f0,
  },
  messageText: { color: palette.c28684f, fontSize: typography.mobile.rawSize.s13 },
  panel: {
    padding: 16,
    borderWidth: 1,
    borderColor: palette.ce5e6e1,
    borderRadius: 15,
    backgroundColor: palette.cfff,
  },
  field: { marginBottom: 14 },
  fieldLabel: {
    marginBottom: 6,
    color: palette.c40534c,
    fontSize: typography.mobile.rawSize.s12,
    fontWeight: typography.weight.bold,
  },
  input: {
    minHeight: 45,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.ce1e5e0,
    borderRadius: 11,
    color: palette.c20372f,
    backgroundColor: palette.cfff,
    fontSize: typography.mobile.rawSize.s14,
  },
  readOnly: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 11,
    backgroundColor: palette.cf1f3f0,
  },
  saveButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    borderRadius: 11,
    backgroundColor: palette.c14a957,
  },
  saveButtonText: { color: palette.cfff, fontWeight: typography.weight.bold },
  formHeading: {
    marginTop: 16,
    color: palette.c1d2e42,
    fontSize: typography.mobile.rawSize.s14,
    fontWeight: typography.weight.bold,
  },
  helper: { marginTop: 3, color: palette.c9aa6b4, fontSize: typography.mobile.rawSize.s11 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: palette.ce2e6e8,
    borderRadius: 16,
    backgroundColor: palette.cfff,
  },
  chipGreen: { borderColor: palette.c14a957, backgroundColor: palette.c14a957 },
  chipRed: { borderColor: palette.cff4659, backgroundColor: palette.cff4659 },
  chipText: { color: palette.c58687b, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.semibold },
  chipActiveText: { color: palette.cfff },
  profileSummary: {
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.ce5e6e1,
    borderRadius: 15,
    backgroundColor: palette.cfff,
  },
  summaryText: { color: palette.c3d5661, fontSize: typography.mobile.rawSize.s12, lineHeight: 18 },
  addressCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
    padding: 13,
    borderWidth: 1,
    borderColor: palette.ce2e9e5,
    borderRadius: 11,
    backgroundColor: palette.cfff,
  },
  addressName: { color: palette.c1d2e42, fontSize: typography.mobile.rawSize.s13, fontWeight: typography.weight.bold },
  addressDetails: { marginTop: 3, color: palette.c82909b, fontSize: typography.mobile.rawSize.s11 },
  themeCard: { padding: 12 },
  themeOptions: { flexDirection: "row", gap: 8 },
  themeOption: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 11,
    backgroundColor: palette.cf8fafa,
  },
  themeActive: {
    borderWidth: 1,
    borderColor: palette.caee5c4,
    backgroundColor: palette.cf0fff5,
  },
  themeText: { color: palette.c8e9aa6, fontSize: typography.mobile.rawSize.s10 },
  themeTextActive: { color: palette.c159b54 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: palette.ce1e5e1,
    borderRadius: 13,
    backgroundColor: palette.cfff,
  },
  searchText: { color: palette.ca8b0b8, fontSize: typography.mobile.rawSize.s12 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.cecefeb,
  },
  personAvatar: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    overflow: "hidden",
    backgroundColor: palette.cecfff2,
  },
  personAvatarImage: { width: "100%", height: "100%" },
  pendingAvatar: { backgroundColor: palette.cfff8e6 },
  suggestedAvatar: { backgroundColor: colors.todaySoft },
  personInitials: { color: palette.c159b54, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold },
  personAction: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: palette.c14a957,
  },
  pendingAction: { backgroundColor: palette.cfff0b8 },
  personActionText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s10, fontWeight: typography.weight.bold },
  pendingText: { color: palette.cbb7b00 },
  suggestedText: { color: colors.todayStrong },
  purchaseMetrics: { flexDirection: "row", gap: 10, marginBottom: 2 },
  spendMetric: {
    flex: 1,
    padding: 15,
    borderRadius: 14,
    backgroundColor: palette.c14a957,
  },
  transactionMetric: {
    flex: 1,
    padding: 15,
    borderRadius: 14,
    backgroundColor: palette.cfff,
    shadowColor: palette.c263c34,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  spendValue: {
    marginTop: 8,
    color: palette.c1d2e42,
    fontSize: typography.mobile.rawSize.s20,
    fontWeight: typography.weight.bold,
  },
  orderCard: {
    marginTop: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: palette.ce5e6e1,
    borderRadius: 14,
    backgroundColor: palette.cfff,
  },
  orderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  status: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.bold,
  },
  orderTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 13,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.ceef0ed,
  },
  promoCard: {
    position: "relative",
    marginTop: 8,
    marginBottom: 2,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.ce5e6e1,
    borderRadius: 14,
    backgroundColor: palette.cfff,
  },
  promoIcon: {
    position: "absolute",
    right: 14,
    top: 14,
    width: 35,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  promoTitle: {
    maxWidth: "75%",
    color: palette.c1d2e42,
    fontSize: typography.mobile.rawSize.s16,
    fontWeight: typography.weight.bold,
  },
  promoCopy: {
    maxWidth: "80%",
    marginTop: 6,
    color: palette.c78879a,
    fontSize: typography.mobile.rawSize.s12,
    lineHeight: 17,
  },
  promoLabel: {
    marginTop: 16,
    color: palette.c9aa6b4,
    fontSize: typography.mobile.rawSize.s9,
    fontWeight: typography.weight.bold,
  },
  promoFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 3,
  },
  code: {
    color: palette.c1d2e42,
    fontSize: typography.mobile.rawSize.s13,
    fontWeight: typography.weight.bold,
    letterSpacing: 0.4,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: palette.c142035,
  },
  copyText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s11, fontWeight: typography.weight.bold },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: palette.crgba_23_60_49_38,
  },
  dialog: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    padding: 24,
    borderRadius: 22,
    backgroundColor: palette.cfffefa,
  },
  dialogIcon: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 27,
    backgroundColor: palette.cfff0f1,
  },
  dialogTitle: {
    marginTop: 14,
    color: palette.c1e372f,
    fontSize: typography.mobile.rawSize.s20,
    fontWeight: typography.weight.bold,
  },
  dialogCopy: {
    marginTop: 8,
    color: palette.c687b73,
    fontSize: typography.mobile.rawSize.s13,
    lineHeight: 19,
    textAlign: "center",
  },
  logoutConfirm: {
    width: "100%",
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
    borderRadius: 11,
    backgroundColor: palette.cc94c56,
  },
  logoutConfirmText: { color: palette.cfff, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold },
  dialogCancel: {
    width: "100%",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  dialogCancelText: { color: palette.c28725e, fontSize: typography.mobile.rawSize.s14, fontWeight: typography.weight.bold },
});
