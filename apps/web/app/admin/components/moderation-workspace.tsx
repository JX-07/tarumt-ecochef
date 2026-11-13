"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ClipboardList, MessageSquareWarning, RefreshCw, Store, ChefHat } from "lucide-react";
import { ThemedSelectControl } from "../../vendor/components/themed-controls";
import { createAuthenticatedWebApi } from "../../../src/lib/api";

type Report = {
  id: string;
  product_name?: string;
  description: string;
  created_at: string;
  reporter_name: string;
  status: string;
  resolution_note?: string;
  resolved_at?: string;
};
type Issue = {
  id: string;
  subject_type: "recipe" | "store";
  subject_name: string;
  category: string;
  status: string;
  report_count: number;
  pending_count: number;
  reports: Report[];
};
type Flag = {
  id: string;
  recipe_title: string;
  author_name: string;
  reviewer_name: string;
  rating: number;
  comment?: string;
  description: string;
  created_at: string;
  status: string;
  resolution_note?: string;
};
type ProductFlag = Omit<Flag, "recipe_title"> & { store_name: string; product_name: string };
type Queue = {
  product_feedback_flags: ProductFlag[];
  product_flag_total: number;
  issue_total: number;
  flag_total: number;
  issues: Issue[];
  feedback_flags: Flag[];
  categories: { id: string; label: string }[];
};
type State = "pending" | "resolved" | "all";
const label = (value: string) => value.replaceAll("_", " ");
const date = (value: string) =>
  new Date(value).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  });

export function ModerationWorkspace() {
  const api = useMemo(() => createAuthenticatedWebApi("/api/ecochef"), []);
  const [queue, setQueue] = useState<Queue>();
  const [state, setState] = useState<State>("pending");
  const [tab, setTab] = useState<"reports" | "feedback" | "store-feedback">("reports");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const data = await api.getModerationQueue<Queue>(state, page * 25, search);
      if (version === generation.current) setQueue(data);
    } catch (reason) {
      if (version === generation.current)
        setError(
          reason instanceof Error ? reason.message : "The moderation queue could not be loaded.",
        );
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [api, state, page, search]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const decide = async (
    kind: "report" | "feedback" | "store-feedback",
    id: string,
    decision: string,
    note: string,
  ) => {
    if (busy) return;
    if (
      !window.confirm(
        kind !== "report" && decision === "removed"
          ? "Remove this feedback from public view and notify both users?"
          : "Save this moderation decision and notify the people involved?",
      )
    )
      return;
    setBusy(id);
    setError(undefined);
    setMessage(undefined);
    try {
      const decisionApi = createAuthenticatedWebApi("/api/ecochef", true);
      if (kind === "report")
        await decisionApi.decideContentReport(id, {
          decision: decision as "upheld" | "dismissed",
          note,
          expected_pending_count:
            queue?.issues.find((issue) => issue.id === id)?.pending_count ?? 1,
        });
      else if (kind === "store-feedback")
        await decisionApi.decideProductFeedbackFlag(id, {
          decision: decision as "removed" | "dismissed",
          note,
        });
      else
        await decisionApi.decideRecipeFeedbackFlag(id, {
          decision: decision as "removed" | "dismissed",
          note,
        });
      setMessage("Decision saved. The people involved can see the outcome and your explanation.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The decision could not be saved. Refresh the queue and try again.",
      );
    } finally {
      setBusy(undefined);
    }
  };
  const issues = queue?.issues ?? [];
  const flags = queue?.feedback_flags ?? [];
  const productFlags = queue?.product_feedback_flags ?? [];
  const total =
    tab === "reports"
      ? (queue?.issue_total ?? 0)
      : tab === "feedback"
        ? (queue?.flag_total ?? 0)
        : (queue?.product_flag_total ?? 0);
  return (
    <div className="admin-workspace moderation-workspace">
      <header className="admin-page-heading">
        <div>
          <small>MODERATION</small>
          <h1>
            <ClipboardList /> Reports &amp; feedback
          </h1>
          <p>
            Review reported recipes and shops, or decide recipe authors’ and shop owners’ feedback
            flags. Times are shown in Malaysia time.
          </p>
        </div>
      </header>
      <div className="moderation-controls">
        <div role="tablist" aria-label="Moderation tasks">
          <button
            role="tab"
            aria-selected={tab === "reports"}
            onClick={() => {
              setTab("reports");
              setPage(0);
            }}
          >
            Content reports ({queue?.issue_total ?? 0})
          </button>
          <button
            role="tab"
            aria-selected={tab === "feedback"}
            onClick={() => {
              setTab("feedback");
              setPage(0);
            }}
          >
            Recipe feedback flags ({queue?.flag_total ?? 0})
          </button>
          <button
            role="tab"
            aria-selected={tab === "store-feedback"}
            onClick={() => {
              setTab("store-feedback");
              setPage(0);
            }}
          >
            Shop feedback flags ({queue?.product_flag_total ?? 0})
          </button>
        </div>
        <label>
          Status
          <ThemedSelectControl
            ariaLabel="Moderation status"
            value={state}
            disabled={!!busy}
            onChange={(value) => {
              setState(value as State);
              setPage(0);
            }}
            options={[
              { value: "pending", label: "Pending" },
              { value: "resolved", label: "Resolved" },
              { value: "all", label: "All" },
            ]}
          />
        </label>
        <label className="moderation-search">
          Search
          <input
            type="search"
            maxLength={200}
            disabled={!!busy}
            placeholder="Recipe, shop, category or description"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" disabled={loading || !!busy} onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
      {error ? (
        <p role="alert" className="form-message error">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="form-message success">
          {message}
        </p>
      ) : null}
      {loading ? (
        <p role="status">Loading moderation tasks…</p>
      ) : tab === "reports" ? (
        <>
          <p className="moderation-explanation">
            Each recipe or shop and report category is one issue. Expand an issue to read every
            report in date order. Confirming a report records the outcome; it does not automatically
            remove the recipe or close the shop.
          </p>
          {!issues.length ? (
            <p className="admin-empty">No matching report issues.</p>
          ) : (
            issues.map((issue) => (
              <section key={issue.id} className="admin-card moderation-task">
                <header>
                  <div>
                    <div className="moderation-category-row">
                      <small className="moderation-subject-type">
                        {issue.subject_type === "recipe" ? (
                          <ChefHat size={16} aria-hidden="true" />
                        ) : (
                          <Store size={16} aria-hidden="true" />
                        )}
                        {issue.subject_type === "recipe" ? "Recipe" : "Shop"}
                      </small>
                      <span
                        className={`moderation-category-badge${issue.category === "food_safety" ? " food-safety" : ""}`}
                      >
                        {queue?.categories.find((category) => category.id === issue.category)
                          ?.label ?? label(issue.category)}
                      </span>
                    </div>
                    <h2>{issue.subject_name}</h2>
                  </div>
                  <span className="admin-pill blue">
                    {issue.report_count} {issue.report_count === 1 ? "report" : "reports"} · 1 issue
                  </span>
                </header>
                <p>
                  Status: <strong>{label(issue.status)}</strong> · {issue.pending_count} awaiting
                  review
                </p>
                <details>
                  <summary>Read report thread ({issue.report_count})</summary>
                  <div className="moderation-thread">
                    {issue.reports.map((report) => (
                      <article key={report.id}>
                        <header>
                          <strong>{report.reporter_name}</strong>
                          <time dateTime={report.created_at}>{date(report.created_at)}</time>
                        </header>
                        <p>
                          {report.product_name ? (
                            <>
                              <strong>Listing: {report.product_name}</strong>
                              <br />
                            </>
                          ) : null}
                          {report.description}
                        </p>
                        <small>
                          {label(report.status)}
                          {report.resolution_note ? ` · Moderator: ${report.resolution_note}` : ""}
                        </small>
                      </article>
                    ))}
                  </div>
                </details>
                {issue.status === "pending" ? (
                  <DecisionForm
                    disabled={!!busy}
                    loading={busy === issue.id}
                    options={[
                      { value: "dismissed", label: "Dismiss report" },
                      { value: "upheld", label: "Confirm report" },
                    ]}
                    onDecide={(decision, note) => decide("report", issue.id, decision, note)}
                  />
                ) : null}
              </section>
            ))
          )}
        </>
      ) : tab === "feedback" ? (
        <>
          <p className="moderation-explanation">
            A recipe author has challenged a specific feedback item. Dismiss the flag to keep the
            feedback, or remove the feedback if it violates the rules. Both people receive your
            explanation.
          </p>
          {!flags.length ? (
            <p className="admin-empty">No matching feedback flags.</p>
          ) : (
            flags.map((flag) => (
              <section className="admin-card moderation-task" key={flag.id}>
                <header>
                  <h2>
                    <MessageSquareWarning size={18} /> {flag.recipe_title}
                  </h2>
                  <span className="admin-pill blue">{label(flag.status)}</span>
                </header>
                <div className="moderation-evidence">
                  <strong>
                    Feedback by {flag.reviewer_name} · {flag.rating}/5
                  </strong>
                  <p>{flag.comment || "Rating only; no written feedback."}</p>
                </div>
                <p>
                  <strong>Flagged by {flag.author_name}</strong> · {date(flag.created_at)}
                </p>
                <p>{flag.description}</p>
                {flag.resolution_note ? (
                  <p className="moderation-evidence">Moderator: {flag.resolution_note}</p>
                ) : null}
                {flag.status === "pending" ? (
                  <DecisionForm
                    disabled={!!busy}
                    loading={busy === flag.id}
                    options={[
                      { value: "dismissed", label: "Dismiss flag / Keep feedback" },
                      { value: "removed", label: "Remove feedback" },
                    ]}
                    onDecide={(decision, note) => decide("feedback", flag.id, decision, note)}
                  />
                ) : null}
              </section>
            ))
          )}
        </>
      ) : (
        <>
          <p className="moderation-explanation">
            Shop owners can flag customer feedback but cannot delete it. Review the entry and their
            reason, then keep or remove the feedback.
          </p>
          {!productFlags.length ? (
            <p className="admin-empty">No matching shop feedback flags.</p>
          ) : (
            productFlags.map((flag) => (
              <section className="admin-card moderation-task" key={flag.id}>
                <header>
                  <h2>
                    <MessageSquareWarning size={18} /> {flag.store_name} · {flag.product_name}
                  </h2>
                  <span className="admin-pill blue">{label(flag.status)}</span>
                </header>
                <div className="moderation-evidence">
                  <strong>
                    {flag.reviewer_name} · {flag.rating}/5
                  </strong>
                  <p>{flag.comment || "Rating only; no description."}</p>
                </div>
                <p>
                  <strong>Flagged by {flag.author_name}</strong> · {date(flag.created_at)}
                </p>
                <p>{flag.description}</p>
                {flag.resolution_note ? (
                  <p className="moderation-evidence">Moderator: {flag.resolution_note}</p>
                ) : null}
                {flag.status === "pending" ? (
                  <DecisionForm
                    disabled={!!busy}
                    loading={busy === flag.id}
                    options={[
                      { value: "dismissed", label: "Dismiss flag / Keep feedback" },
                      { value: "removed", label: "Remove feedback" },
                    ]}
                    onDecide={(decision, note) => decide("store-feedback", flag.id, decision, note)}
                  />
                ) : null}
              </section>
            ))
          )}
        </>
      )}
      <div className="moderation-controls moderation-pagination">
        <button
          disabled={loading || !!busy || page === 0}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <span>
          {total ? `${page * 25 + 1}–${Math.min((page + 1) * 25, total)} of ${total}` : "0 tasks"}
        </span>
        <button
          disabled={loading || !!busy || (page + 1) * 25 >= total}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function DecisionForm({
  disabled,
  loading,
  options,
  onDecide,
}: {
  disabled: boolean;
  loading: boolean;
  options: { value: string; label: string }[];
  onDecide: (decision: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const id = useId();
  const isReport = options.some((option) => option.value === "upheld");
  const suggestions = isReport
    ? [
        {
          label: "Confirm: information mismatch",
          text: "The reported content contains information that does not match the available details. Please correct the inaccurate information.",
        },
        {
          label: "Confirm: needs clarification",
          text: "The reported content is missing important details and could confuse users. Please add clear and accurate information.",
        },
        {
          label: "Dismiss: not supported",
          text: "The information provided does not sufficiently support this report. No further action has been taken at this time.",
        },
        {
          label: "Dismiss: content is clear",
          text: "The relevant details are already stated in the content. The report does not establish an issue that requires further action.",
        },
      ]
    : [
        {
          label: "Keep: relevant feedback",
          text: "The feedback describes the reviewer's experience and is relevant to the item reviewed. The flag has been dismissed and the feedback remains visible.",
        },
        {
          label: "Keep: insufficient evidence",
          text: "The information provided does not sufficiently support removing this feedback. The flag has been dismissed and the feedback remains visible.",
        },
        {
          label: "Remove: inappropriate content",
          text: "The feedback contains inappropriate personal remarks rather than a relevant review. It has been removed from public view.",
        },
        {
          label: "Remove: unrelated feedback",
          text: "The feedback is unrelated to the item being reviewed and does not provide a relevant account of the reviewer's experience. It has been removed from public view.",
        },
      ];
  return (
    <div className="moderation-decision">
      <div className="moderation-explanation-templates">
        <span>Suggested explanations</span>
        <div>
          {suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion.label}
              disabled={disabled}
              onClick={() => setNote(suggestion.text)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
        <small>
          Choose an explanation, then edit it to match what you reviewed. Select the decision below
          to submit.
        </small>
      </div>
      <label htmlFor={id}>Decision explanation (shown to users)</label>
      <textarea
        id={id}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        minLength={10}
        maxLength={1000}
        disabled={disabled}
        placeholder="Explain what you reviewed and why you reached this decision."
      />
      <small>{note.trim().length}/1000 characters · at least 10 required</small>
      <div>
        {options.map((option) => (
          <button
            type="button"
            className={
              option.value === "removed"
                ? "moderation-remove"
                : option.value === "upheld"
                  ? "moderation-confirm"
                  : "moderation-dismiss"
            }
            key={option.value}
            disabled={disabled || note.trim().length < 10}
            onClick={() => void onDecide(option.value, note.trim())}
          >
            {loading ? "Saving…" : option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
