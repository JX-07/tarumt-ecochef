BEGIN;

CREATE TABLE content_report_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type VARCHAR(10) NOT NULL CHECK (subject_type IN ('recipe', 'store')),
    subject_id UUID NOT NULL,
    category VARCHAR(30) NOT NULL CHECK (category IN ('misinformation','food_safety','misleading_listing','inappropriate_content','harassment','spam','other')),
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','upheld','dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(subject_type, subject_id, category)
);

CREATE TABLE content_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES content_report_issues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','upheld','dismissed')),
    resolution_note VARCHAR(1000),
    resolved_at TIMESTAMPTZ,
    moderator_id UUID REFERENCES administrators(id),
    UNIQUE(issue_id, user_id)
);
CREATE INDEX content_report_issues_queue_idx ON content_report_issues(status, updated_at);
CREATE INDEX content_reports_issue_idx ON content_reports(issue_id, created_at);
CREATE INDEX content_reports_user_idx ON content_reports(user_id, created_at DESC);

CREATE TABLE content_report_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES content_report_issues(id),
    moderator_id UUID NOT NULL REFERENCES administrators(id),
    decision VARCHAR(12) NOT NULL CHECK(decision IN ('upheld','dismissed')),
    note VARCHAR(1000) NOT NULL,
    reports_resolved INTEGER NOT NULL CHECK(reports_resolved > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep existing reports and their original reporter/date. Unclassified historical
-- reasons stay in Other rather than guessing a user's chosen category.
INSERT INTO content_report_issues(subject_type,subject_id,category,created_at,updated_at)
SELECT 'recipe',recipe_id,'other',MIN(date_reported),MAX(date_reported)
FROM recipe_reports GROUP BY recipe_id;
INSERT INTO content_reports(issue_id,user_id,description,created_at)
SELECT i.id,r.reporter_user_id,'Previous report: ' || r.reason,r.date_reported
FROM recipe_reports r JOIN content_report_issues i
ON i.subject_type='recipe' AND i.subject_id=r.recipe_id AND i.category='other';

INSERT INTO content_report_issues(subject_type,subject_id,category,created_at,updated_at)
SELECT 'store',p.store_id,'misleading_listing',MIN(r.date_reported),MAX(r.date_reported)
FROM product_reports r JOIN products p ON p.id=r.product_id GROUP BY p.store_id;
INSERT INTO content_reports(issue_id,user_id,description,created_at)
SELECT i.id,r.reporter_user_id,
       LEFT(string_agg('Product: ' || p.product_name || '. ' || r.report_request, E'\n' ORDER BY r.date_reported),2000),
       MIN(r.date_reported)
FROM product_reports r JOIN products p ON p.id=r.product_id
JOIN content_report_issues i ON i.subject_type='store' AND i.subject_id=p.store_id AND i.category='misleading_listing'
GROUP BY i.id,r.reporter_user_id;

ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK(category IN (
    'sensor_alert','ingredient_expiry','meal_reminder','payment','delivery','order','promotion','moderation'
));
INSERT INTO schema_migrations(version) VALUES ('0046') ON CONFLICT DO NOTHING;
COMMIT;
