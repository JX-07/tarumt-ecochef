"use client";

import { useRouter } from "next/navigation";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ApiClientError } from "@ecochef/api-client";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ImagePlus,
  Images,
  MailCheck,
  MapPin,
  Plus,
  Save,
  Store,
  Trash2,
  UserPlus,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { firebaseAuth } from "../../../src/lib/firebase";
import { sendVerificationForCurrentUser } from "../../../src/lib/auth";
import { useVendor, type Shop } from "../components/vendor-context";
import { StripeConnectCard } from "../components/stripe-connect-card";
import {
  ThemedDatePickerControl,
  ThemedSelectControl,
} from "../components/themed-controls";

const DRAFT_KEY = "ecochef.vendor.store-onboarding";
const storeTypes = [
  "Department Stores",
  "Specialty Stores",
  "Discount Retailers",
  "Off-price Retailers",
  "Supermarkets & Hypermarkets",
  "Warehouse Retailers",
  "Convenience Stores",
  "Chain stores",
  "Non-store Retailers",
];
const prefixes = ["+60", "+65", "+62", "+66"];
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type Phone = { prefix: string; number: string };
type Hours = Record<string, { open: string; close: string; closed: boolean }>;
type ApiValidationIssue = { field: string; message: string };
type Draft = {
  slot_order_limit: number;
  slot_item_limit: number;
  name: string;
  street_address: string;
  postal_code: string;
  city: string;
  state: string;
  country: string;
  additional_location_details: string;
  description: string;
  category: string;
  contact_email: string;
  phones: Phone[];
  icon_url: string;
  cover_image_url: string;
  operating_hours_schedule: Hours;
};
type TeamMember = {
  account_id: string;
  name: string;
  email: string;
  assigned_role: string;
  can_edit_store: boolean;
  status: string;
  is_owner: boolean;
};
type PendingInvitation = {
  id: string;
  email: string;
  assigned_role: string;
  created_at: string;
};

const defaultHours = () =>
  Object.fromEntries(
    days.map((day, index) => [
      day,
      {
        open: index > 4 ? "09:00" : "08:00",
        close: index > 4 ? "18:00" : "20:00",
        closed: false,
      },
    ]),
  ) as Hours;
const emptyDraft = (): Draft => ({
  name: "",
  street_address: "",
  postal_code: "",
  city: "",
  state: "",
  country: "",
  additional_location_details: "",
  description: "",
  category: "",
  contact_email: "",
  phones: [{ prefix: "+60", number: "" }],
  icon_url: "",
  cover_image_url: "",
  slot_order_limit: 10,
  slot_item_limit: 100,
  operating_hours_schedule: defaultHours(),
});
const parsePhone = (phone: string): Phone => {
  const prefix = prefixes.find((item) => phone.startsWith(item)) ?? "+60";
  return {
    prefix,
    number: phone.startsWith(prefix)
      ? phone.slice(prefix.length).trim()
      : phone,
  };
};
const formatTime = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
};
const hoursDuration = (value: {
  open: string;
  close: string;
  closed: boolean;
}) => {
  if (value.closed) return 0;
  const [openHour, openMinute] = value.open.split(":").map(Number),
    [closeHour, closeMinute] = value.close.split(":").map(Number);
  return (
    Math.max(0, closeHour * 60 + closeMinute - openHour * 60 - openMinute) / 60
  );
};
const formatDuration = (hours: number) =>
  `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr${hours === 1 ? "" : "s"}`;
const normaliseDraft = (
  value: Partial<Draft> & { helpline_phones?: string[] },
): Draft => ({
  ...emptyDraft(),
  ...value,
  phones: value.phones?.length
    ? value.phones
    : value.helpline_phones?.length
      ? value.helpline_phones.map(parsePhone)
      : [{ prefix: "+60", number: "" }],
  operating_hours_schedule: {
    ...defaultHours(),
    ...(value.operating_hours_schedule ?? {}),
  },
});
const fromShop = (shop: Shop): Draft =>
  normaliseDraft({
    name: shop.name,
    street_address: shop.street_address || shop.address,
    postal_code: shop.postal_code || "",
    city: shop.city || "",
    state: shop.state || "",
    country: shop.country || "Malaysia",
    additional_location_details: shop.additional_location_details || "",
    description: shop.description || "",
    category: shop.category || "",
    contact_email: shop.contact_email || "",
    helpline_phones: shop.helpline_phones?.length
      ? shop.helpline_phones
      : [shop.phone_number || ""],
    icon_url: shop.icon_url || "",
    cover_image_url: shop.cover_image_url || "",
    slot_order_limit: shop.slot_order_limit ?? 10,
    slot_item_limit: shop.slot_item_limit ?? 100,
    operating_hours_schedule: shop.operating_hours_schedule,
  });

export default function StoreProfile() {
  const router = useRouter();
  const { stores, loading, reload, ownerEmail } = useVendor();
  const shop = stores[0];
  const [tab, setTab] = useState<"details" | "hours">("details");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState("");
  const [submissionErrors, setSubmissionErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [locations, setLocations] = useState<Record<string, string[]>>({});
  const [onboardingStep, setOnboardingStep] = useState<
    "details" | "hours" | "email"
  >("details");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [emailVerificationMessage, setEmailVerificationMessage] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [pendingLogo, setPendingLogo] = useState("");
  const [savedDraft, setSavedDraft] = useState(() =>
    JSON.stringify(emptyDraft()),
  );
  const [pendingNavigation, setPendingNavigation] = useState<string>();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const allowNavigationRef = useRef(false);

  useEffect(() => {
    if (shop) {
      const next = fromShop(shop);
      setDraft(next);
      setSavedDraft(JSON.stringify(next));
      return;
    }
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved)
      try {
        setDraft(normaliseDraft(JSON.parse(saved)));
      } catch {}
  }, [shop?.id]);
  useEffect(() => {
    if (!shop) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft, shop]);
  useEffect(() => {
    if (!shop && ownerEmail && !draft.contact_email)
      setDraft((current) => ({ ...current, contact_email: ownerEmail }));
  }, [draft.contact_email, ownerEmail, shop]);
  useEffect(() => {
    let active = true;
    void createAuthenticatedWebApi("/api/ecochef")
      .getVendorLocations<{
        country: string;
        states: Record<string, string[]>;
      }>()
      .then((result) => {
        if (active) setLocations(result.states);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!/^\d{5}$/.test(draft.postal_code)) return;
    let active = true;
    const timer = setTimeout(() => {
      void createAuthenticatedWebApi("/api/ecochef")
        .getVendorPostcode<{ city: string; state: string; country: string }>(
          draft.postal_code,
        )
        .then((location) => {
          if (active)
            setDraft((current) => ({
              ...current,
              city: location.city,
              state: location.state,
              country: location.country,
            }));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft.postal_code]);

  const hasUnsavedChanges = Boolean(
    shop && JSON.stringify(draft) !== savedDraft,
  );
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptNavigation = (event: MouseEvent) => {
      if (
        allowNavigationRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !target ||
        target.target === "_blank" ||
        target.hasAttribute("download")
      )
        return;
      const destination = new URL(target.href, window.location.href);
      if (
        destination.href === window.location.href ||
        (destination.hash &&
          destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(destination.href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", interceptNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", interceptNavigation, true);
    };
  }, [hasUnsavedChanges]);

  if (loading)
    return (
      <main className="workspace">
        <p className="workspace-note">Loading store profile…</p>
      </main>
    );

  const phoneValues = draft.phones
    .filter((phone) => phone.number.trim())
    .map((phone) => `${phone.prefix} ${phone.number.trim()}`);
  const stateOptions = Array.from(
    new Set([...Object.keys(locations), ...(draft.state ? [draft.state] : [])]),
  );
  const cityOptions = Array.from(
    new Set([
      ...(locations[draft.state] || []),
      ...(draft.city ? [draft.city] : []),
    ]),
  );
  const payload = () => ({
    name: draft.name,
    address: [
      draft.street_address,
      draft.additional_location_details,
      draft.postal_code,
      draft.city,
      draft.state,
      draft.country,
    ]
      .filter(Boolean)
      .join(", "),
    street_address: draft.street_address,
    postal_code: draft.postal_code,
    city: draft.city,
    state: draft.state,
    country: draft.country,
    additional_location_details: draft.additional_location_details || undefined,
    description: draft.description || undefined,
    category: draft.category,
    contact_email: draft.contact_email,
    helpline_phones: phoneValues,
    phone_number: phoneValues[0],
    icon_url: draft.icon_url || undefined,
    cover_image_url: draft.cover_image_url || undefined,
    delivery_fee: Number(shop?.delivery_fee || 0),
    estimated_delivery_minutes: shop?.estimated_delivery_minutes || 30,
    slot_order_limit: draft.slot_order_limit,
    slot_item_limit: draft.slot_item_limit,
    operating_hours_schedule: draft.operating_hours_schedule,
  });
  const showSubmissionErrors = (
    errors: string[],
    fields: Record<string, string> = {},
  ) => {
    setMessage("");
    setSubmissionErrors(errors);
    setFieldErrors(fields);
    requestAnimationFrame(() => {
      errorSummaryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      errorSummaryRef.current?.focus({ preventScroll: true });
    });
  };
  const validateDetails = () => {
    const fields: Record<string, string> = {};
    if (!draft.name.trim()) fields.name = "Enter the public store name.";
    else if (draft.name.trim().length < 2 || draft.name.length > 100)
      fields.name = "Store name must contain 2–100 characters.";
    if (!draft.contact_email.trim())
      fields.contact_email = "Enter the store contact email.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact_email))
      fields.contact_email =
        "Enter a valid email, such as contact@yourstore.com.";
    else if (
      !shop &&
      ownerEmail &&
      draft.contact_email.trim().toLowerCase() !== ownerEmail.toLowerCase()
    )
      fields.contact_email = `Use your verified Business account email: ${ownerEmail}.`;
    if (!draft.category) fields.category = "Select a store type.";
    if (!phoneValues.length)
      fields.phone = "Enter at least one customer helpline phone number.";
    else if (phoneValues.some((phone) => phone.length > 20))
      fields.phone =
        "Each phone number must contain no more than 20 characters.";
    if (!draft.street_address.trim())
      fields.street_address = "Enter the street address.";
    if (!/^\d{5}$/.test(draft.postal_code))
      fields.postal_code = "Enter a valid five-digit Malaysian postal code.";
    if (!draft.state) fields.state = "Select a state.";
    if (!draft.city) fields.city = "Select a city.";
    if (!draft.country) fields.country = "Select Malaysia as the country.";
    if (draft.description.length > 500)
      fields.description =
        "Mission & Description must contain no more than 500 characters.";
    if (draft.additional_location_details.length > 255)
      fields.additional_location_details =
        "Additional Location Details must contain no more than 255 characters.";
    return fields;
  };
  const nextToHours = () => {
    const fields = validateDetails();
    if (Object.keys(fields).length) {
      showSubmissionErrors(Object.values(fields), fields);
      return;
    }
    setSubmissionErrors([]);
    setFieldErrors({});
    setOnboardingStep("hours");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async (): Promise<boolean> => {
    if (shop && !hasUnsavedChanges) {
      setSubmissionErrors([]);
      setFieldErrors({});
      setMessage("No changes applied.");
      return true;
    }
    const fields = validateDetails();
    for (const day of days) {
      const hours = draft.operating_hours_schedule[day];
      if (
        !hours.closed &&
        (!hours.open || !hours.close || hours.open >= hours.close)
      )
        fields[`hours.${day}`] =
          `${day}: closing time must be later than opening time.`;
    }
    const totalHours = days.reduce(
      (total, day) =>
        total + hoursDuration(draft.operating_hours_schedule[day]),
      0,
    );
    if (totalHours < 1)
      fields.operating_hours =
        "Invalid Operating Hour Set: Operation Hour cannot be less than 1 hour";
    const errors = Object.values(fields);
    if (errors.length) {
      showSubmissionErrors(errors, fields);
      return false;
    }
    setSubmissionErrors([]);
    setFieldErrors({});
    setSubmitting(true);
    try {
      if (shop) {
        await createAuthenticatedWebApi("/api/ecochef").updateVendorStore(
          shop.id,
          payload(),
        );
        setSavedDraft(JSON.stringify(draft));
        await reload();
        setMessage("Store settings saved.");
      } else {
        await createAuthenticatedWebApi("/api/ecochef").createVendorStore(
          payload(),
        );
        sessionStorage.removeItem(DRAFT_KEY);
        setSubmittedEmail(draft.contact_email);
        setOnboardingStep("email");
        setMessage("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return true;
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error
          ? Number(error.status)
          : 0;
      const apiIssues =
        error instanceof ApiClientError &&
        Array.isArray(error.response?.details)
          ? (error.response.details as ApiValidationIssue[])
          : [];
      const fieldMap: Record<string, string> = {
        name: "name",
        address: "street_address",
        street_address: "street_address",
        postal_code: "postal_code",
        state: "state",
        city: "city",
        country: "country",
        additional_location_details: "additional_location_details",
        description: "description",
        category: "category",
        contact_email: "contact_email",
        phone_number: "phone",
        helpline_phones: "phone",
      };
      const rejectedFields = Object.fromEntries(
        apiIssues.map((issue) => [
          fieldMap[issue.field] ?? issue.field,
          issue.message,
        ]),
      );
      const guidance =
        status === 401 || status === 403
          ? "Your session is no longer authorised. Sign in again, then return to Store Onboarding and resubmit."
          : status === 422 && apiIssues.length
            ? "Correct the highlighted fields below, then submit the store request again."
            : status === 422
              ? "Review the highlighted required fields and their formats, then submit again."
              : status >= 500
                ? shop
                  ? "The store service could not save your settings. Your changes remain on this page; wait a moment and try again."
                  : "The store service could not process the request. Your entries are still saved in this session; wait a moment and try again."
                : "Check your connection and try again. Your entries are still saved in this session.";
      const apiMessages = apiIssues.map(
        (issue) => `${humaniseField(issue.field)}: ${issue.message}`,
      );
      showSubmissionErrors(
        apiMessages.length
          ? [...apiMessages, guidance]
          : [
              error instanceof Error
                ? error.message
                : "The store request could not be submitted.",
              guidance,
            ],
        rejectedFields,
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  };
  const clear = () => {
    setDraft(emptyDraft());
    sessionStorage.removeItem(DRAFT_KEY);
    setConfirmClear(false);
    setSubmissionErrors([]);
    setFieldErrors({});
    setMessage("All onboarding fields were cleared.");
  };
  const upload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPendingLogo(String(reader.result));
    reader.readAsDataURL(file);
  };
  const uploadBackdrop = (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPG, PNG, or WebP backdrop image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new window.Image();
      image.onload = () => {
        const width = 1600;
        const height = 900;
        const scale = Math.max(
          width / image.naturalWidth,
          height / image.naturalHeight,
        );
        const renderedWidth = image.naturalWidth * scale;
        const renderedHeight = image.naturalHeight * scale;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(
          image,
          (width - renderedWidth) / 2,
          (height - renderedHeight) / 2,
          renderedWidth,
          renderedHeight,
        );
        setDraft((current) => ({
          ...current,
          cover_image_url: canvas.toDataURL("image/jpeg", 0.86),
        }));
        setMessage("Backdrop prepared. Save Store Settings to publish it.");
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  const updatePhone = (index: number, update: Partial<Phone>) =>
    setDraft({
      ...draft,
      phones: draft.phones.map((phone, current) =>
        current === index ? { ...phone, ...update } : phone,
      ),
    });
  const leaveFor = (href: string) => {
    allowNavigationRef.current = true;
    const destination = new URL(href, window.location.href);
    if (destination.origin === window.location.origin)
      router.push(
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
    else window.location.assign(destination.href);
  };
  const discardAndLeave = () => {
    if (!pendingNavigation) return;
    setDraft(JSON.parse(savedDraft) as Draft);
    leaveFor(pendingNavigation);
  };
  const verifyBusinessEmail = async () => {
    try {
      const user = firebaseAuth.currentUser;
      if (!user)
        throw new Error("Sign in again to verify your business email.");
      await user.reload();
      if (user.email?.toLowerCase() !== submittedEmail.toLowerCase())
        throw new Error(
          `Your signed-in business email must match ${submittedEmail}.`,
        );
      if (!user.emailVerified) {
        await sendVerificationForCurrentUser();
        setEmailVerificationMessage(
          `A verification link was sent to ${submittedEmail}. Open it, then select Check Verification again.`,
        );
        return;
      }
      setEmailVerified(true);
      setEmailVerificationMessage(`${submittedEmail} is verified.`);
    } catch (error) {
      setEmailVerificationMessage(
        error instanceof Error
          ? error.message
          : "Business email verification could not be completed.",
      );
    }
  };

  if (!shop && onboardingStep === "email")
    return (
      <main className="workspace onboarding-workspace">
        <header className="page-head">
          <div>
            <h1>Verify Business Email</h1>
          </div>
        </header>
        <section className="email-verification-card">
          <span>
            <MailCheck size={34} />
          </span>
          <p>FINAL VERIFICATION</p>
          <h2>Verify your business email</h2>
          <p>
            Your store request was submitted. Confirm the verified Firebase
            business account for <strong>{submittedEmail}</strong> before
            continuing to Store Settings.
          </p>
          {emailVerificationMessage && (
            <div
              className={`email-verification-message${emailVerified ? " success" : ""}`}
              role="status"
            >
              {emailVerificationMessage}
            </div>
          )}
          <div className="email-verification-actions">
            <button
              className="secondary"
              onClick={() => void verifyBusinessEmail()}
            >
              {emailVerified ? "Verified" : "Check Verification"}
            </button>
            <button
              className="cta"
              disabled={!emailVerified}
              onClick={() => void reload()}
            >
              Continue to Store Settings
            </button>
          </div>
        </section>
      </main>
    );

  if (!shop)
    return (
      <main className="workspace onboarding-workspace">
        <header className="page-head">
          <div>
            <h1>Store Onboarding</h1>
          </div>
        </header>
        <div className="onboarding-progress">
          <span className="complete">1</span>
          <b>Store Details</b>
          <i />
          <span className={onboardingStep === "hours" ? "active" : ""}>2</span>
          <b>Operating Hours</b>
          <i />
          <span>3</span>
          <b>Email Verification</b>
        </div>
        {submissionErrors.length > 0 && (
          <SubmissionErrorSummary
            ref={errorSummaryRef}
            errors={submissionErrors}
          />
        )}
        {message && <p className="vendor-message">{message}</p>}
        {onboardingStep === "details" ? (
          <section className="setup-card onboarding-card">
            <div className="onboarding-intro">
              <span>
                <Store size={30} />
              </span>
              <p>STORE ONBOARDING</p>
              <h2>Tell us about your store</h2>
              <p>
                Complete the details below to submit your storefront for
                administrator review. Your progress remains available until you
                sign out.
              </p>
            </div>
            <div className="onboarding-form">
              <RequiredLabel
                plain
                text="Public Store Name"
                error={fieldErrors.name}
              >
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="e.g. Always TT Fresh Organics"
                />
              </RequiredLabel>
              <label
                className={
                  fieldErrors.description ? "field-has-error" : undefined
                }
              >
                Mission &amp; Description
                <textarea
                  className="vertical-resize"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  placeholder="Share your mission and the store details"
                />
                <FieldError message={fieldErrors.description} />
              </label>
              <div className="form-row">
                <RequiredLabel
                  plain
                  text="Store Contact Email"
                  error={fieldErrors.contact_email}
                >
                  <input
                    type="email"
                    value={draft.contact_email}
                    onChange={(event) =>
                      setDraft({ ...draft, contact_email: event.target.value })
                    }
                    placeholder="e.g. contact@yourstore.com"
                  />
                </RequiredLabel>
                <StoreTypeSelect
                  value={draft.category}
                  error={fieldErrors.category}
                  onChange={(category) => setDraft({ ...draft, category })}
                />
              </div>
              <PhoneFields
                draft={draft}
                error={fieldErrors.phone}
                setDraft={setDraft}
                updatePhone={updatePhone}
              />
              <RequiredLabel
                text="Street Address"
                error={fieldErrors.street_address}
              >
                <input
                  className="street-input"
                  value={draft.street_address}
                  onChange={(event) => {
                    const street_address = event.target.value;
                    setDraft({
                      ...draft,
                      street_address,
                      country: street_address.trim() ? "Malaysia" : "",
                    });
                  }}
                  placeholder="42 Green Land, Jalan Eco"
                />
              </RequiredLabel>
              <div className="address-grid">
                <RequiredLabel
                  plain
                  text="Postal Code"
                  error={fieldErrors.postal_code}
                >
                  <input
                    inputMode="numeric"
                    maxLength={5}
                    value={draft.postal_code}
                    onChange={(event) =>
                      setDraft({ ...draft, postal_code: event.target.value })
                    }
                    placeholder="11900"
                  />
                </RequiredLabel>
                <RequiredLabel plain text="State" error={fieldErrors.state}>
                  <ThemedSelect
                    ariaLabel="State"
                    value={draft.state}
                    placeholder="Select State"
                    options={stateOptions}
                    onChange={(state) =>
                      setDraft({ ...draft, state, city: "" })
                    }
                  />
                </RequiredLabel>
                <RequiredLabel plain text="City" error={fieldErrors.city}>
                  <ThemedSelect
                    ariaLabel="City"
                    value={draft.city}
                    placeholder="Select City"
                    options={cityOptions}
                    onChange={(city) => setDraft({ ...draft, city })}
                  />
                </RequiredLabel>
                <RequiredLabel plain text="Country" error={fieldErrors.country}>
                  <ThemedSelect
                    ariaLabel="Country"
                    value={draft.country}
                    placeholder="Select Country"
                    options={["Malaysia"]}
                    onChange={(country) => setDraft({ ...draft, country })}
                  />
                </RequiredLabel>
              </div>
              <label
                className={`field-label-regular${fieldErrors.additional_location_details ? " field-has-error" : ""}`}
              >
                Additional Location Details
                <input
                  value={draft.additional_location_details}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      additional_location_details: event.target.value,
                    })
                  }
                  placeholder="Unit, floor, landmark, or pickup instructions"
                />
                <FieldError message={fieldErrors.additional_location_details} />
              </label>
              <LogoUpload draft={draft} upload={upload} />
              <BackdropUpload draft={draft} upload={uploadBackdrop} />
              <div className="onboarding-actions">
                <button
                  className="secondary danger-action"
                  onClick={() => setConfirmClear(true)}
                >
                  <Trash2 size={16} /> Clear all
                </button>
                <button className="cta" onClick={nextToHours}>
                  Next
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="settings-card hours-card onboarding-hours-card">
            <h2>
              <Clock size={18} /> Operating Hours
            </h2>
            <div className="settings-body">
              <p className="hours-guidance">
                Set when customers can collect their orders. Mark a day closed
                if your store does not operate that day.
              </p>
              <label>Maximum orders per 30-minute slot<input type="number" min={1} max={1000} required value={draft.slot_order_limit} onChange={(event) => setDraft({ ...draft, slot_order_limit: Number(event.target.value) })} /></label>
              <label>Maximum items per 30-minute slot<input type="number" min={1} max={10000} required value={draft.slot_item_limit} onChange={(event) => setDraft({ ...draft, slot_item_limit: Number(event.target.value) })} /></label>
              {days.map((day) => {
                const value = draft.operating_hours_schedule[day];
                const error = fieldErrors[`hours.${day}`];
                return (
                  <div
                    className={`hours-row${value.closed ? " is-closed" : ""}${error ? " field-has-error" : ""}`}
                    key={day}
                  >
                    <div>
                      <strong>{day}</strong>
                      <small>
                        {value.closed
                          ? "Closed"
                          : `${formatTime(value.open)} – ${formatTime(value.close)}`}
                      </small>
                    </div>
                    <label className="closed-check">
                      <input
                        type="checkbox"
                        checked={value.closed}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            operating_hours_schedule: {
                              ...draft.operating_hours_schedule,
                              [day]: { ...value, closed: event.target.checked },
                            },
                          })
                        }
                      />{" "}
                      Closed
                    </label>
                    <div>
                      <div className="time-range">
                        <input
                          type="time"
                          disabled={value.closed}
                          value={value.open}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              operating_hours_schedule: {
                                ...draft.operating_hours_schedule,
                                [day]: { ...value, open: event.target.value },
                              },
                            })
                          }
                        />
                        <span>to</span>
                        <input
                          type="time"
                          disabled={value.closed}
                          value={value.close}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              operating_hours_schedule: {
                                ...draft.operating_hours_schedule,
                                [day]: { ...value, close: event.target.value },
                              },
                            })
                          }
                        />
                      </div>
                      <FieldError message={error} />
                    </div>
                  </div>
                );
              })}
              <div className="onboarding-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setOnboardingStep("details");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  className="cta"
                  disabled={submitting}
                  onClick={() => void save()}
                >
                  <Save size={16} />{" "}
                  {submitting ? "Submitting…" : "Submit Store Request"}
                </button>
              </div>
            </div>
          </section>
        )}
        {confirmClear && (
          <ClearConfirmation
            close={() => setConfirmClear(false)}
            clear={clear}
          />
        )}
        {pendingLogo && (
          <LogoCropModal
            source={pendingLogo}
            cancel={() => setPendingLogo("")}
            confirm={(icon_url) => {
              setDraft((current) => ({ ...current, icon_url }));
              setPendingLogo("");
            }}
          />
        )}
      </main>
    );

  return (
    <main
      className={`workspace store-workspace${shop.can_edit_store ? "" : " view-only"}`}
    >
      <header className="store-page-head">
        <div>
          <h1>Storefront Profile &amp; Operations</h1>
          <p>
            {shop.can_edit_store
              ? "Configure your public store presence, pickup windows, and storefront details."
              : "You have view-only access to this store profile."}
          </p>
        </div>
        {shop.can_edit_store && (
          <button className="cta" onClick={() => void save()}>
            <Save size={16} /> Save Store Settings
          </button>
        )}
      </header>
      {submissionErrors.length > 0 && (
        <SubmissionErrorSummary
          ref={errorSummaryRef}
          errors={submissionErrors}
          title="We could not save the store settings."
        />
      )}
      {message && (
        <p
          className={`vendor-message store-settings-message${message === "No changes applied." ? " no-changes" : ""}`}
        >
          {message}
        </p>
      )}
      <div className="store-tabs">
        <div className="store-tab-options">
          <button
            className={tab === "details" ? "active" : ""}
            onClick={() => setTab("details")}
          >
            Store Details &amp; Branding
          </button>
          <button
            className={tab === "hours" ? "active" : ""}
            onClick={() => setTab("hours")}
          >
            Operating Hours
          </button>
        </div>
        <em
          className={`pill ${shop.status === "approved" ? "verified" : shop.status}`}
        >
          Status: {storeStatusLabel(shop.status)}
        </em>
      </div>
      {tab === "details" ? (
        <div className="store-settings-grid">
          <div>
            <section className="settings-card">
              <h2>
                <Store size={18} /> Basic Merchant Details
              </h2>
              <div className="settings-body">
                <RequiredLabel
                  plain
                  text="Public Store Name"
                  error={fieldErrors.name}
                >
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </RequiredLabel>
                <label
                  className={
                    fieldErrors.description ? "field-has-error" : undefined
                  }
                >
                  Mission &amp; Description
                  <textarea
                    className="vertical-resize"
                    value={draft.description}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                    placeholder="Share your mission and the store details"
                  />
                  <FieldError message={fieldErrors.description} />
                </label>
                <div className="form-row">
                  <RequiredLabel
                    plain
                    text="Store Contact Email"
                    error={fieldErrors.contact_email}
                  >
                    <input
                      type="email"
                      value={draft.contact_email}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          contact_email: event.target.value,
                        })
                      }
                      placeholder="e.g. contact@yourstore.com"
                    />
                  </RequiredLabel>
                  <StoreTypeSelect
                    value={draft.category}
                    error={fieldErrors.category}
                    onChange={(category) => setDraft({ ...draft, category })}
                  />
                </div>
                <PhoneFields
                  draft={draft}
                  error={fieldErrors.phone}
                  setDraft={setDraft}
                  updatePhone={updatePhone}
                />
              </div>
            </section>
            <section className="settings-card">
              <h2>
                <MapPin size={18} /> Location
              </h2>
              <div className="settings-body">
                <RequiredLabel
                  text="Street Address"
                  error={fieldErrors.street_address}
                >
                  <input
                    className="street-input"
                    value={draft.street_address}
                    onChange={(event) => {
                      const street_address = event.target.value;
                      setDraft({
                        ...draft,
                        street_address,
                        country: street_address.trim() ? "Malaysia" : "",
                      });
                    }}
                  />
                </RequiredLabel>
                <div className="address-grid">
                  <RequiredLabel
                    plain
                    text="Postal Code"
                    error={fieldErrors.postal_code}
                  >
                    <input
                      value={draft.postal_code}
                      onChange={(event) =>
                        setDraft({ ...draft, postal_code: event.target.value })
                      }
                    />
                  </RequiredLabel>
                  <RequiredLabel plain text="State" error={fieldErrors.state}>
                    <ThemedSelect
                      ariaLabel="State"
                      value={draft.state}
                      placeholder="Select State"
                      options={stateOptions}
                      onChange={(state) =>
                        setDraft({ ...draft, state, city: "" })
                      }
                    />
                  </RequiredLabel>
                  <RequiredLabel plain text="City" error={fieldErrors.city}>
                    <ThemedSelect
                      ariaLabel="City"
                      value={draft.city}
                      placeholder="Select City"
                      options={cityOptions}
                      onChange={(city) => setDraft({ ...draft, city })}
                    />
                  </RequiredLabel>
                  <RequiredLabel
                    plain
                    text="Country"
                    error={fieldErrors.country}
                  >
                    <ThemedSelect
                      ariaLabel="Country"
                      value={draft.country}
                      placeholder="Select Country"
                      options={["Malaysia"]}
                      onChange={(country) => setDraft({ ...draft, country })}
                    />
                  </RequiredLabel>
                </div>
                <label
                  className={`field-label-regular${fieldErrors.additional_location_details ? " field-has-error" : ""}`}
                >
                  Additional Location Details
                  <input
                    value={draft.additional_location_details}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        additional_location_details: event.target.value,
                      })
                    }
                    placeholder="Unit, floor, landmark, or pickup instructions"
                  />
                  <FieldError
                    message={fieldErrors.additional_location_details}
                  />
                </label>
              </div>
            </section>
            <StoreTeam shop={shop} />
            {shop.is_owner ? <StripeConnectCard shop={shop} /> : null}
          </div>
          <aside>
            <section className="settings-card logo-card">
              <h2>
                <Images size={18} /> Store Logo &amp; Branding
              </h2>
              <LogoUpload draft={draft} upload={upload} showHeading={false} />
              <BackdropUpload draft={draft} upload={uploadBackdrop} />
            </section>
          </aside>
        </div>
      ) : (
        <div className="hours-settings-stack"><div className="operating-limits-layout">
          <section className="settings-card hours-card">
            <h2>
              <Clock size={18} /> Operating Hours
            </h2>
            <div className="settings-body">
              {days.map((day) => {
                const value = draft.operating_hours_schedule[day];
                return (
                  <div
                    className={`hours-row${value.closed ? " is-closed" : ""}`}
                    key={day}
                  >
                    <div>
                      <strong>
                        {day}
                        <em>
                          {value.closed
                            ? "0 hrs"
                            : formatDuration(hoursDuration(value))}
                        </em>
                      </strong>
                      <small>
                        {value.closed
                          ? "Closed"
                          : `${formatTime(value.open)} – ${formatTime(value.close)}`}
                      </small>
                    </div>
                    <label className="closed-check">
                      <input
                        type="checkbox"
                        checked={value.closed}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            operating_hours_schedule: {
                              ...draft.operating_hours_schedule,
                              [day]: { ...value, closed: event.target.checked },
                            },
                          })
                        }
                      />{" "}
                      Closed
                    </label>
                    <div className="time-range">
                      <input
                        type="time"
                        disabled={value.closed}
                        value={value.open}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            operating_hours_schedule: {
                              ...draft.operating_hours_schedule,
                              [day]: { ...value, open: event.target.value },
                            },
                          })
                        }
                      />
                      <span>to</span>
                      <input
                        type="time"
                        disabled={value.closed}
                        value={value.close}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            operating_hours_schedule: {
                              ...draft.operating_hours_schedule,
                              [day]: { ...value, close: event.target.value },
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
              <footer className="weekly-hours-total">
                <span>Weekly operating total</span>
                <strong>
                  {formatDuration(
                    days.reduce(
                      (total, day) =>
                        total +
                        hoursDuration(draft.operating_hours_schedule[day]),
                      0,
                    ),
                  )}
                </strong>
              </footer>
            </div>
          </section>
          <section className="settings-card preorder-limits-card"><h2><Clock size={18}/> Pre-Order Limits</h2><div className="settings-body"><label>Maximum orders per 30-minute slot<input type="number" min={1} max={1000} required value={draft.slot_order_limit} onChange={(event) => setDraft({ ...draft, slot_order_limit: Number(event.target.value) })} /></label><label>Maximum items per 30-minute slot<input type="number" min={1} max={10000} required value={draft.slot_item_limit} onChange={(event) => setDraft({ ...draft, slot_item_limit: Number(event.target.value) })} /></label></div></section></div>
          <HolidayClosingNotice storeId={shop.id} />
        </div>
      )}
      {pendingLogo && (
        <LogoCropModal
          source={pendingLogo}
          cancel={() => setPendingLogo("")}
          confirm={(icon_url) => {
            setDraft((current) => ({ ...current, icon_url }));
            setPendingLogo("");
          }}
        />
      )}
      {pendingNavigation && (
        <UnsavedChangesConfirmation
          keepEditing={() => setPendingNavigation(undefined)}
          discard={discardAndLeave}
        />
      )}
    </main>
  );
}

type Holiday = {
  id: string;
  starts_on: string;
  ends_on: string;
  whole_day: boolean;
  opens_at?: string;
  closes_at?: string;
  reason: string;
};
function HolidayClosingNotice({ storeId }: { storeId: string }) {
  const now = new Date(),
    today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const [holidays, setHolidays] = useState<Holiday[]>([]),
    [start, setStart] = useState(today),
    [end, setEnd] = useState(today),
    [wholeDay, setWholeDay] = useState(true),
    [open, setOpen] = useState("09:00"),
    [close, setClose] = useState("17:00"),
    [reason, setReasonValue] = useState(""),
    [message, setMessage] = useState(""),
    [messageTone, setMessageTone] = useState<"error" | "success">("error"),
    [deletingId, setDeletingId] = useState<string>(),
    [pendingDelete, setPendingDelete] = useState<Holiday>();
  const setReason = (value: string) => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    setReasonValue(words.length > 30 ? words.slice(0, 30).join(" ") : value);
  };
  const timeOptions = Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2),
      minute = index % 2 ? "30" : "00",
      value = `${String(hour).padStart(2, "0")}:${minute}`,
      period = hour < 12 ? "AM" : "PM";
    return { value, label: `${hour % 12 || 12}:${minute} ${period}` };
  });
  useEffect(() => {
    if (start < today) setStart(today);
    if (end < today) setEnd(today);
  }, [today, start, end]);
  const load = () =>
    createAuthenticatedWebApi("/api/ecochef")
      .getVendorHolidays<{ holidays: Holiday[] }>(storeId)
      .then((result) => setHolidays(result.holidays));
  useEffect(() => {
    void load();
  }, [storeId]);
  const add = async () => {
    if (
      !reason.trim() ||
      start < today ||
      end < start ||
      (!wholeDay && open >= close)
    ) {
      setMessageTone("error");
      setMessage(
        "Choose a valid date range, operating time, and closure reason.",
      );
      return;
    }
    try {
      await createAuthenticatedWebApi("/api/ecochef").createVendorHoliday(
        storeId,
        {
          starts_on: start,
          ends_on: end,
          whole_day: wholeDay,
          opens_at: wholeDay ? null : open,
          closes_at: wholeDay ? null : close,
          reason: reason.trim(),
        },
      );
      setReason("");
      setMessageTone("success");
      setMessage("Holiday Closing Notice added successfully.");
      await load();
    } catch (error) {
      setMessageTone("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The Holiday Closing Notice could not be applied.",
      );
    }
  };
  const remove = async (holiday: Holiday) => {
    setDeletingId(holiday.id);
    setMessage("");
    try {
      await createAuthenticatedWebApi("/api/ecochef").deleteVendorHoliday(
        storeId,
        holiday.id,
      );
      setMessageTone("success");
      setMessage("Holiday Closing Notice deleted successfully.");
      await load();
    } catch (error) {
      setMessageTone("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The Holiday Closing Notice could not be deleted.",
      );
    } finally {
      setDeletingId(undefined);
      setPendingDelete(undefined);
    }
  };
  const holidayDateLabel = (holiday: Holiday) => {
    const format = (value: string) =>
      new Date(`${value}T00:00:00`).toLocaleDateString("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    return holiday.starts_on === holiday.ends_on
      ? format(holiday.starts_on)
      : `${format(holiday.starts_on)} – ${format(holiday.ends_on)}`;
  };
  return (
    <>
      <section className="settings-card holiday-card">
      <header>
        <div>
          <h2>
            <CalendarDays size={18} /> Holiday Closing Notice
          </h2>
          <p>
            Apply a full-day closure or reduced hours for a specific date or
            range. No approval is required.
          </p>
        </div>
      </header>
      <div className="settings-body">
        <div className="holiday-date-grid">
          <ThemedDatePickerControl
            label="Start date"
            minimum={today}
            value={start}
            onChange={(value) => {
              setStart(value);
              if (end < value) setEnd(value);
            }}
          />
          <ThemedDatePickerControl
            label="End date"
            minimum={start}
            value={end}
            onChange={setEnd}
          />
        </div>
        <HolidayRangeCalendar
          start={start}
          end={end}
          minimum={today}
          change={(nextStart, nextEnd) => {
            setStart(nextStart);
            setEnd(nextEnd);
          }}
        />
        <label className="whole-day-toggle">
          <input
            type="checkbox"
            checked={wholeDay}
            onChange={(event) => setWholeDay(event.target.checked)}
          />
          <span className="holiday-checkbox" aria-hidden="true">
            {wholeDay ? <Check size={13} /> : null}
          </span>
          <span>Whole day</span>
        </label>
        <div className={`holiday-times${wholeDay ? " disabled" : ""}`}>
          <div>
            <span className="holiday-field-heading">Temporary opening</span>
            <ThemedSelectControl
              disabled={wholeDay}
              ariaLabel="Temporary opening time"
              value={open}
              onChange={setOpen}
              options={timeOptions}
            />
          </div>
          <span className="holiday-time-separator">to</span>
          <div>
            <span className="holiday-field-heading">Temporary closing</span>
            <ThemedSelectControl
              disabled={wholeDay}
              ariaLabel="Temporary closing time"
              value={close}
              onChange={setClose}
              options={timeOptions}
            />
          </div>
        </div>
        <label>
          <span className="holiday-field-heading">
            Reason shown to customers
          </span>
          <textarea
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Closed for Deepavali celebrations"
          />
          <small className="holiday-word-count">
            {reason.trim() ? reason.trim().split(/\s+/).length : 0}/30 words
          </small>
        </label>
        {message ? (
          <p
            className={`holiday-message ${messageTone}`}
            role={messageTone === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}
        <button className="cta holiday-add" onClick={() => void add()}>
          <Plus size={15} /> Apply Holiday Notice
        </button>
        {holidays.length ? (
          <div className="holiday-list">
            {holidays.map((holiday) => (
              <article key={holiday.id}>
                <b>
                  {new Date(`${holiday.starts_on}T00:00:00`).toLocaleDateString(
                    "en-MY",
                    { day: "2-digit", month: "short", year: "numeric" },
                  )}
                  {holiday.ends_on !== holiday.starts_on
                    ? ` – ${new Date(`${holiday.ends_on}T00:00:00`).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}`
                    : ""}
                </b>
                <span>
                  {holiday.whole_day
                    ? "Closed all day"
                    : `${formatTime(holiday.opens_at!)} – ${formatTime(holiday.closes_at!)}`}
                </span>
                <button
                  type="button"
                  className="holiday-delete"
                  aria-label="Delete holiday closure notice"
                  disabled={deletingId === holiday.id}
                  onClick={() => setPendingDelete(holiday)}
                >
                  <Trash2 size={16} />
                </button>
                <p>{holiday.reason}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
      </section>
      {pendingDelete ? (
        <div className="modal-backdrop">
          <section
            className="modal-card confirm-card holiday-delete-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="holiday-delete-title"
            aria-describedby="holiday-delete-description"
          >
            <span><Trash2 size={24} /></span>
            <h2 id="holiday-delete-title">Delete Holiday Closing Notice?</h2>
            <p id="holiday-delete-description">
              The closure scheduled for <strong>{holidayDateLabel(pendingDelete)}</strong> will be removed. Customers will no longer see this notice.
            </p>
            <footer>
              <button className="neutral-button" type="button" disabled={Boolean(deletingId)} onClick={() => setPendingDelete(undefined)}>Cancel</button>
              <button className="danger-button" type="button" disabled={Boolean(deletingId)} onClick={() => void remove(pendingDelete)}>{deletingId ? "Deleting…" : "Delete Notice"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function HolidayRangeCalendar({
  start,
  end,
  minimum,
  change,
}: {
  start: string;
  end: string;
  minimum: string;
  change: (start: string, end: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date(`${start}T00:00:00`)),
    [dragStart, setDragStart] = useState("");
  const first = new Date(month.getFullYear(), month.getMonth(), 1),
    gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const daysInGrid = Array.from({ length: 42 }, (_, index) => {
    const value = new Date(gridStart);
    value.setDate(gridStart.getDate() + index);
    return value;
  });
  const iso = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const range = (from: string, to: string) =>
    change(from <= to ? from : to, from <= to ? to : from);
  return (
    <div className="holiday-range-calendar">
      <header>
        <button
          type="button"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft />
        </button>
        <strong>
          {month.toLocaleDateString("en-MY", {
            month: "long",
            year: "numeric",
          })}
        </strong>
        <button
          type="button"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight />
        </button>
      </header>
      <div className="holiday-weekdays">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="holiday-days">
        {daysInGrid.map((day) => {
          const value = iso(day),
            disabled = value < minimum;
          return (
            <button
              type="button"
              disabled={disabled}
              key={value}
              className={`${day.getMonth() !== month.getMonth() ? "outside " : ""}${value >= start && value <= end ? "in-range " : ""}${value === start || value === end ? "selected" : ""}`}
              onPointerDown={() => {
                setDragStart(value);
                range(value, value);
              }}
              onPointerEnter={(event) => {
                if (dragStart && event.buttons === 1) range(dragStart, value);
              }}
              onPointerUp={() => setDragStart("")}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      <small>
        Tap one date or drag across several dates to select a closure range.
      </small>
    </div>
  );
}

function humaniseField(field: string) {
  return field
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
function formatPhoneNumber(value: string, prefix: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (prefix === "+60") {
    const leading = digits.length > 9 ? 3 : 2;
    return [
      digits.slice(0, leading),
      digits.slice(leading, leading + 3),
      digits.slice(leading + 3),
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (prefix === "+65")
    return [digits.slice(0, 4), digits.slice(4, 8)].filter(Boolean).join(" ");
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ");
}
function FieldError({ message }: { message?: string }) {
  return message ? (
    <small className="inline-field-error">{message}</small>
  ) : null;
}
function RequiredLabel({
  text,
  children,
  plain = false,
  error,
}: {
  text: string;
  children: ReactNode;
  plain?: boolean;
  error?: string;
}) {
  return (
    <label
      className={`${plain ? "field-label-regular" : ""}${error ? " field-has-error" : ""}`.trim()}
    >
      <span className="required-title">
        {text}
        <b className="required-mark" aria-hidden="true">
          *
        </b>
      </span>
      {children}
      <FieldError message={error} />
    </label>
  );
}
function StoreTypeSelect({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <RequiredLabel plain text="Store Type" error={error}>
      <ThemedSelect
        ariaLabel="Store Type"
        value={value}
        placeholder="Select Store Types"
        options={storeTypes}
        onChange={onChange}
      />
    </RequiredLabel>
  );
}
function PhoneFields({
  draft,
  setDraft,
  updatePhone,
  error,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  updatePhone: (index: number, update: Partial<Phone>) => void;
  error?: string;
}) {
  return (
    <div className={`helplines${error ? " field-has-error" : ""}`}>
      <span className="required-title">
        Customer Helpline Phone
        <b className="required-mark" aria-hidden="true">
          *
        </b>
      </span>
      {draft.phones.map((phone, index) => (
        <div className="phone-row" key={index}>
          <ThemedSelect
            compact
            ariaLabel="Country calling code"
            value={phone.prefix}
            placeholder="Code"
            options={prefixes}
            onChange={(prefix) =>
              updatePhone(index, {
                prefix,
                number: formatPhoneNumber(phone.number, prefix),
              })
            }
          />
          <input
            inputMode="tel"
            value={phone.number}
            onChange={(event) =>
              updatePhone(index, {
                number: formatPhoneNumber(event.target.value, phone.prefix),
              })
            }
            placeholder="12 888 0199"
          />
          <button
            aria-label="Remove phone"
            onClick={() =>
              setDraft({
                ...draft,
                phones: draft.phones.filter((_, current) => current !== index),
              })
            }
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <FieldError message={error} />
      <button
        className="add-phone"
        onClick={() =>
          setDraft({
            ...draft,
            phones: [...draft.phones, { prefix: "+60", number: "" }],
          })
        }
      >
        <Plus size={15} /> Add another number
      </button>
    </div>
  );
}

function ThemedSelect({
  value,
  placeholder,
  options,
  onChange,
  ariaLabel,
  compact = false,
}: {
  value: string;
  placeholder: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={root} className={`themed-select${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="themed-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value ? "" : "placeholder"}>
          {value || placeholder}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div
          className="themed-select-menu"
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option === value}
              className={option === value ? "selected" : ""}
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span>{option}</span>
              {option === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function storeStatusLabel(status: string) {
  if (status === "approved") return "Verified";
  if (status === "pending_approval") return "Awaiting Admin Approval";
  if (status === "rejected") return "Changes Required";
  if (status === "suspended") return "Temporarily Suspended";
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function StoreTeam({ shop }: { shop: Shop }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pending, setPending] = useState<PendingInvitation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Staff");
  const [message, setMessage] = useState("");
  const api = () => createAuthenticatedWebApi("/api/ecochef");
  const load = () =>
    api()
      .getVendorStoreTeam<{
        members: TeamMember[];
        pending_invitations: PendingInvitation[];
        can_manage_team: boolean;
      }>(shop.id)
      .then((result) => {
        setMembers(result.members);
        setPending(result.pending_invitations);
        setCanManage(result.can_manage_team);
      });
  useEffect(() => {
    void load();
  }, [shop.id]);
  const invite = async () => {
    try {
      const result = await api().inviteVendorStoreStaff<{ message: string }>(
        shop.id,
        { email, assigned_role: role },
      );
      setMessage(result.message);
      setEmail("");
      setRole("Staff");
      setInviteOpen(false);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The staff invitation could not be sent.",
      );
    }
  };
  const setPermission = async (member: TeamMember, value: boolean) => {
    await api().updateVendorStoreStaffPermission(
      shop.id,
      member.account_id,
      value,
    );
    await load();
  };
  return (
    <section className="settings-card team-settings-card">
      <header>
        <h2>
          <Users size={18} /> Team Staff &amp; Permissions
        </h2>
        {canManage && (
          <button
            className="secondary invite-staff-button"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus size={16} /> Invite Staff
          </button>
        )}
      </header>
      {message && <p className="team-message">{message}</p>}
      <div className="team-table">
        <div className="team-row team-head">
          <span>Staff Member</span>
          <span>Assigned Role</span>
          <span>Status</span>
          <span>Store Profile Access</span>
        </div>
        {members.map((member) => (
          <div className="team-row" key={member.account_id}>
            <span>
              <strong>{member.name}</strong>
              <small>{member.email}</small>
            </span>
            <span>{member.assigned_role}</span>
            <span>
              <em className="team-active">Active</em>
            </span>
            <span>
              {member.is_owner ? (
                <strong>Owner — Full Access</strong>
              ) : canManage ? (
                <label className="permission-toggle">
                  <input
                    type="checkbox"
                    checked={member.can_edit_store}
                    onChange={(event) =>
                      void setPermission(member, event.target.checked)
                    }
                  />{" "}
                  Can edit store
                </label>
              ) : member.can_edit_store ? (
                "Can edit store"
              ) : (
                "View only"
              )}
            </span>
          </div>
        ))}
        {pending.map((invitation) => (
          <div className="team-row" key={invitation.id}>
            <span>
              <strong>Invited staff</strong>
              <small>{invitation.email}</small>
            </span>
            <span>{invitation.assigned_role}</span>
            <span>
              <em className="team-pending">Pending Invite</em>
            </span>
            <span>View only until accepted</span>
          </div>
        ))}
      </div>
      {inviteOpen && (
        <div className="modal-backdrop">
          <section className="modal-card invite-staff-modal">
            <header>
              <h2>Invite Staff</h2>
              <button onClick={() => setInviteOpen(false)}>
                <X />
              </button>
            </header>
            <label>
              Business Account Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="staff@business.com"
              />
            </label>
            <label>
              Assigned Role
              <ThemedSelect
                ariaLabel="Assigned Role"
                value={role}
                placeholder="Select Role"
                options={[
                  "Store Manager",
                  "Inventory Specialist",
                  "Cashier",
                  "Staff",
                ]}
                onChange={setRole}
              />
            </label>
            <p className="invite-permission-note">
              Store Profile edit access can be granted after the staff member
              accepts this invitation.
            </p>
            <footer>
              <button onClick={() => setInviteOpen(false)}>Cancel</button>
              <button
                className="cta"
                disabled={!email.trim()}
                onClick={() => void invite()}
              >
                Send Invitation
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
function LogoUpload({
  draft,
  upload,
  showHeading = true,
}: {
  draft: Draft;
  upload: (file?: File) => void;
  showHeading?: boolean;
}) {
  return (
    <div className="store-icon-field">
      {showHeading && <h3>Store Icon</h3>}
      <label className="logo-upload">
        {draft.icon_url ? (
          <img src={draft.icon_url} alt="Store icon preview" />
        ) : (
          <span>
            <ImagePlus size={32} />
          </span>
        )}
        <strong>Click to Upload Icon</strong>
        <small>40px × 40px - PNG/JPEG</small>
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

function BackdropUpload({
  draft,
  upload,
}: {
  draft: Draft;
  upload: (file?: File) => void;
}) {
  return (
    <div className="store-backdrop-field">
      <div>
        <h3>Shop Backdrop</h3>
        <p>
          Upload a clear landscape photo of your storefront or products. This
          appears behind your shop information in the Marketplace.
        </p>
      </div>
      <label className="backdrop-upload">
        {draft.cover_image_url ? (
          <img src={draft.cover_image_url} alt="Shop backdrop preview" />
        ) : (
          <span>
            <ImagePlus size={34} />
            <strong>Add shop backdrop</strong>
          </span>
        )}
        <small>
          {draft.cover_image_url
            ? "Click the image to replace it"
            : "Landscape recommended"}{" "}
          · prepared to 1600 × 900
        </small>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

function LogoCropModal({
  source,
  cancel,
  confirm,
}: {
  source: string;
  cancel: () => void;
  confirm: (value: string) => void;
}) {
  const previewSize = 280;
  const outputSize = 256;
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        x: number;
        y: number;
      }
    | undefined
  >(undefined);
  const [imageSize, setImageSize] = useState({
    width: previewSize,
    height: previewSize,
  });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const baseScale = Math.max(
    previewSize / imageSize.width,
    previewSize / imageSize.height,
  );
  const renderedWidth = imageSize.width * baseScale * zoom;
  const renderedHeight = imageSize.height * baseScale * zoom;
  const clampPosition = (next: { x: number; y: number }, nextZoom = zoom) => {
    const width = imageSize.width * baseScale * nextZoom;
    const height = imageSize.height * baseScale * nextZoom;
    const limitX = Math.max(0, (width - previewSize) / 2);
    const limitY = Math.max(0, (height - previewSize) / 2);
    return {
      x: Math.max(-limitX, Math.min(limitX, next.x)),
      y: Math.max(-limitY, Math.min(limitY, next.y)),
    };
  };
  const changeZoom = (next: number) => {
    const value = Math.max(1, Math.min(3, next));
    setZoom(value);
    setPosition((current) => clampPosition(current, value));
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      ...position,
    };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(
      clampPosition({
        x: drag.x + event.clientX - drag.clientX,
        y: drag.y + event.clientY - drag.clientY,
      }),
    );
  };
  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId)
      dragRef.current = undefined;
  };
  const confirmCrop = () => {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = outputSize / previewSize;
    const left = (previewSize - renderedWidth) / 2 + position.x;
    const top = (previewSize - renderedHeight) / 2 + position.y;
    context.drawImage(
      image,
      left * ratio,
      top * ratio,
      renderedWidth * ratio,
      renderedHeight * ratio,
    );
    confirm(canvas.toDataURL("image/png", 0.92));
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal-card logo-crop-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logo-crop-title"
      >
        <header>
          <div>
            <h2 id="logo-crop-title">Crop Store Logo</h2>
            <p>Drag the image to reposition it, then zoom until it fits.</p>
          </div>
          <button
            type="button"
            aria-label="Cancel logo cropping"
            onClick={cancel}
          >
            <X />
          </button>
        </header>
        <div
          className="logo-crop-viewport"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <img
            ref={imageRef}
            src={source}
            alt="Store logo crop preview"
            draggable={false}
            onLoad={(event) =>
              setImageSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            style={{
              width: renderedWidth,
              height: renderedHeight,
              transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
            }}
          />
        </div>
        <label className="logo-zoom-control">
          <ZoomOut size={18} aria-hidden="true" />
          <span className="sr-only">Logo zoom</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(event) => changeZoom(Number(event.target.value))}
            aria-label="Logo zoom"
          />
          <ZoomIn size={18} aria-hidden="true" />
        </label>
        <footer>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="cta" onClick={confirmCrop}>
            <Check size={16} /> Confirm
          </button>
        </footer>
      </section>
    </div>
  );
}

function UnsavedChangesConfirmation({
  keepEditing,
  discard,
}: {
  keepEditing: () => void;
  discard: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card confirm-card unsaved-changes-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
      >
        <span>
          <Trash2 size={24} />
        </span>
        <h2 id="unsaved-changes-title">
          Discard unsaved store profile changes?
        </h2>
        <p>
          You have edits that have not been saved. Keep editing to remain on
          this page, or discard the changes and leave.
        </p>
        <footer>
          <button
            className="neutral-button"
            type="button"
            onClick={keepEditing}
          >
            Keep Editing
          </button>
          <button className="danger-button" type="button" onClick={discard}>
            Discard Changes
          </button>
        </footer>
      </section>
    </div>
  );
}
const SubmissionErrorSummary = forwardRef<
  HTMLDivElement,
  { errors: string[]; title?: string }
>(function SubmissionErrorSummary(
  { errors, title = "We could not submit the store request." },
  ref,
) {
  return (
    <div
      ref={ref}
      className="vendor-message submission-error-summary"
      role="alert"
      tabIndex={-1}
    >
      <strong>{title}</strong>
      <p>Please correct the following:</p>
      <ul>
        {errors.map((error, index) => (
          <li key={`${index}-${error}`}>{error}</li>
        ))}
      </ul>
    </div>
  );
});
function ClearConfirmation({
  close,
  clear,
}: {
  close: () => void;
  clear: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal-card confirm-card">
        <span>
          <Trash2 size={24} />
        </span>
        <h2>Clear all store details?</h2>
        <p>
          This removes every unsaved onboarding field from this session. This
          action cannot be undone.
        </p>
        <footer>
          <button className="neutral-button" onClick={close}>
            Keep Details
          </button>
          <button className="danger-button" onClick={clear}>
            Confirm
          </button>
        </footer>
      </section>
    </div>
  );
}
