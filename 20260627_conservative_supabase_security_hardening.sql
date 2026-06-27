-- ============================================================
-- Salla Shop - Conservative Supabase Security Hardening
-- الهدف:
--   1) تحسين الأمان دون تعديل أجسام الدوال.
--   2) الحفاظ على صلاحيات anon/authenticated/service_role الحالية
--      للدوال العادية حتى لا تتعطل وظائف التطبيق.
--   3) إغلاق الاستدعاء المباشر لدوال Trigger فقط.
--   4) إصلاح تحذيرات search_path الأربعة المحددة.
--
-- مهم:
-- - هذا الملف لا يحذف دوال أو Policies أو جداول.
-- - لا يغير RLS.
-- - لا يغير سياسة product-images لتجنب كسر list/download إن كان التطبيق يستخدمها.
-- - لا يلغي صلاحيات authenticated للدوال العادية.
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- منع تشغيل نسختين من الهجرة في نفس الوقت.
DO $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('salla_conservative_security_hardening_v1')) THEN
    RAISE EXCEPTION 'Security hardening is already running in another session';
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 1) إنشاء نسخة تدقيق غير مكشوفة عبر Data API
-- ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS security_audit;

REVOKE ALL ON SCHEMA security_audit FROM PUBLIC;
REVOKE ALL ON SCHEMA security_audit FROM anon, authenticated;
GRANT USAGE ON SCHEMA security_audit TO service_role;

CREATE TABLE IF NOT EXISTS security_audit.function_hardening_backup (
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  captured_by text NOT NULL DEFAULT current_user,
  function_oid oid NOT NULL,
  function_signature text NOT NULL,
  security_definer boolean NOT NULL,
  return_type text NOT NULL,
  function_config text[],
  function_acl text,
  anon_can_execute boolean NOT NULL,
  authenticated_can_execute boolean NOT NULL,
  service_role_can_execute boolean NOT NULL,
  function_definition text NOT NULL
);

REVOKE ALL ON security_audit.function_hardening_backup
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT
ON security_audit.function_hardening_backup
TO service_role;

INSERT INTO security_audit.function_hardening_backup (
  function_oid,
  function_signature,
  security_definer,
  return_type,
  function_config,
  function_acl,
  anon_can_execute,
  authenticated_can_execute,
  service_role_can_execute,
  function_definition
)
SELECT
  p.oid,
  p.oid::regprocedure::text,
  p.prosecdef,
  p.prorettype::regtype::text,
  p.proconfig,
  p.proacl::text,
  has_function_privilege('anon', p.oid, 'EXECUTE'),
  has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  has_function_privilege('service_role', p.oid, 'EXECUTE'),
  pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f';

-- ------------------------------------------------------------
-- 2) منع الأدوار غير الموثوقة من إنشاء Objects داخل public
-- لا يؤثر على SELECT/INSERT/UPDATE/DELETE أو استدعاء الدوال.
-- ------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3) إصلاح Search Path للدوال التي ذكرها Security Advisor فقط
-- لا يتم تعديل جسم الدالة أو التوقيع أو الصلاحيات.
--
-- public موجود للحفاظ على المراجع غير المؤهلة الموجودة حاليًا.
-- pg_temp في النهاية.
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS function_signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'normalize_arabic_search',
        'touch_product_alert_updated_at',
        'financial_safe_numeric',
        'normalize_moderation_country'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, extensions, pg_temp',
      r.function_signature
    );
  END LOOP;
END
$$;

-- ------------------------------------------------------------
-- 4) إزالة EXECUTE الموروثة من PUBLIC لجميع SECURITY DEFINER
-- ثم إعادة نفس الوصول الفعلي للأدوار الأساسية كما كان قبل الهجرة.
--
-- النتيجة:
-- - لا تتغير وظائف التطبيق الحالية.
-- - لا تحصل أدوار PostgreSQL أخرى تلقائيًا على EXECUTE عبر PUBLIC.
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_anon boolean;
  v_authenticated boolean;
  v_service_role boolean;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      p.oid::regprocedure AS function_signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
  LOOP
    v_anon := has_function_privilege('anon', r.oid, 'EXECUTE');
    v_authenticated := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    v_service_role := has_function_privilege('service_role', r.oid, 'EXECUTE');

    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',
      r.function_signature
    );

    IF v_anon THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO anon',
        r.function_signature
      );
    END IF;

    IF v_authenticated THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO authenticated',
        r.function_signature
      );
    END IF;

    IF v_service_role THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO service_role',
        r.function_signature
      );
    END IF;
  END LOOP;
END
$$;

-- ------------------------------------------------------------
-- 5) دوال Trigger لا تحتاج أن يستدعيها المستخدم عبر RPC.
-- إغلاق الاستدعاء المباشر لا يغير الـTriggers الموجودة.
-- نترك الاستدعاء لـ service_role لأعمال الصيانة فقط.
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS function_signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      r.function_signature
    );

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      r.function_signature
    );
  END LOOP;
END
$$;

-- ------------------------------------------------------------
-- 6) حماية افتراضية للدوال المستقبلية التي ينشئها postgres.
-- لا تؤثر على الدوال الموجودة.
-- تم تركها معطلة عمدًا لتجنب كسر نشر دالة مستقبلية لم تُمنح صلاحياتها.
--
-- فعّلها لاحقًا فقط إذا كانت كل Migrations تمنح EXECUTE صراحة:
--
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres
-- REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- ------------------------------------------------------------

COMMIT;

-- ============================================================
-- تقرير التحقق بعد التنفيذ
-- ============================================================

-- أ) تأكيد Search Path
SELECT
  p.oid::regprocedure AS function_signature,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'normalize_arabic_search',
    'touch_product_alert_updated_at',
    'financial_safe_numeric',
    'normalize_moderation_country'
  )
ORDER BY 1;

-- ب) يجب أن تكون كل دوال Trigger غير قابلة للاستدعاء من المستخدمين
SELECT
  p.oid::regprocedure AS trigger_function,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prorettype = 'trigger'::regtype
ORDER BY 1;

-- ج) تقرير الدوال SECURITY DEFINER العادية التي ما زالت متاحة.
-- هذا تقرير فقط؛ لم تُسحب صلاحياتها حتى لا تتعطل وظائف التطبيق.
SELECT
  p.oid::regprocedure AS function_signature,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
ORDER BY 1;
