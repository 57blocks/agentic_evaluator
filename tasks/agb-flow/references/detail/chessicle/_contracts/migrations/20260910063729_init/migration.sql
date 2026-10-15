-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending_consent', 'active', 'deleted');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'code_sent', 'expired', 'suspended_awaiting_consent', 'confirmed', 'declined');

-- CreateEnum
CREATE TYPE "AuditEventName" AS ENUM ('consent_code_sent', 'consent_confirmed', 'consent_declined', 'consent_revoked', 'account_deleted', 'photo_deleted');

-- CreateEnum
CREATE TYPE "GameSource" AS ENUM ('photo', 'manual');

-- CreateEnum
CREATE TYPE "OcrJobStatus" AS ENUM ('uploading', 'prescanning', 'reconstructing', 'awaiting_confirmation', 'done', 'failed', 'abandoned');

-- CreateEnum
CREATE TYPE "OcrFailureCode" AS ENUM ('prescan_failed', 'not_a_scoresheet', 'abandoned', 'timeout');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('analyzing', 'complete', 'partial');

-- CreateEnum
CREATE TYPE "MoveClassification" AS ENUM ('brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder');

-- CreateEnum
CREATE TYPE "MetricEventName" AS ENUM ('photo_uploaded', 'prescan_failed', 'moves_confirmed', 'analysis_completed', 'report_viewed', 'tournament_count_submitted');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'pending_consent',
    "childName" TEXT,
    "birthYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slidingExpires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentEmail" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'pending',
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "revokeTokenHash" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parent_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_denials" (
    "id" TEXT NOT NULL,
    "parentEmailHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_denials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "name" "AuditEventName" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pgn" TEXT NOT NULL,
    "source" "GameSource" NOT NULL,
    "ocrConfirmations" JSONB,
    "playedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT,
    "status" "OcrJobStatus" NOT NULL DEFAULT 'uploading',
    "readablePercent" DOUBLE PRECISION,
    "paperFormat" TEXT,
    "failureCode" "OcrFailureCode",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ocr_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_ambiguities" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "ply" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "repair" TEXT,
    "resolvedSan" TEXT,

    CONSTRAINT "ocr_ambiguities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultId" TEXT,
    "inFlight" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_reports" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'analyzing',
    "engineVersion" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "analysedThroughPly" INTEGER,
    "accuracy" DOUBLE PRECISION,
    "summary" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_moves" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "ply" INTEGER NOT NULL,
    "san" TEXT NOT NULL,
    "classification" "MoveClassification" NOT NULL,
    "evalCp" INTEGER NOT NULL,
    "explanation" TEXT,
    "conceptTags" TEXT[],

    CONSTRAINT "analysis_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_recommendations" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "ply" INTEGER NOT NULL,
    "conceptTag" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opponent_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opponentQuery" JSONB NOT NULL,
    "matchedProfile" JSONB,
    "summary" JSONB,
    "sourcesQueried" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opponent_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_lookup_cache" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "federation" TEXT,
    "currentRating" INTEGER,
    "ratingHistory" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rating_lookup_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" "MetricEventName" NOT NULL,
    "properties" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_checkins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gamesPlayedReported" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT,
    "stars" INTEGER NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "toHash" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_objects" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_fetch_log" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "attempt" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_fetch_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_provider_calls" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "durationMs" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_provider_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_jobs" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "pass" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" TEXT NOT NULL,
    "reportId" TEXT,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "durationMs" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_allowlist" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_allowlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "login_codes_userId_createdAt_idx" ON "login_codes"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "parent_consents_userId_key" ON "parent_consents"("userId");

-- CreateIndex
CREATE INDEX "consent_denials_parentEmailHash_idx" ON "consent_denials"("parentEmailHash");

-- CreateIndex
CREATE INDEX "audit_events_name_createdAt_idx" ON "audit_events"("name", "createdAt");

-- CreateIndex
CREATE INDEX "games_userId_createdAt_id_idx" ON "games"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_jobs_gameId_key" ON "ocr_jobs"("gameId");

-- CreateIndex
CREATE INDEX "ocr_jobs_userId_startedAt_idx" ON "ocr_jobs"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_ambiguities_jobId_slotIndex_key" ON "ocr_ambiguities"("jobId", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_userId_scope_key_key" ON "idempotency_keys"("userId", "scope", "key");

-- CreateIndex
CREATE INDEX "analysis_reports_gameId_createdAt_idx" ON "analysis_reports"("gameId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_moves_reportId_ply_key" ON "analysis_moves"("reportId", "ply");

-- CreateIndex
CREATE INDEX "study_recommendations_reportId_ply_idx" ON "study_recommendations"("reportId", "ply");

-- CreateIndex
CREATE INDEX "opponent_reports_userId_createdAt_idx" ON "opponent_reports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "rating_lookup_cache_name_idx" ON "rating_lookup_cache"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rating_lookup_cache_source_playerId_key" ON "rating_lookup_cache"("source", "playerId");

-- CreateIndex
CREATE INDEX "metric_events_name_occurredAt_idx" ON "metric_events"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "metric_events_userId_name_idx" ON "metric_events"("userId", "name");

-- CreateIndex
CREATE INDEX "tournament_checkins_userId_periodStart_idx" ON "tournament_checkins"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "reviews_userId_createdAt_idx" ON "reviews"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "email_deliveries_toHash_createdAt_idx" ON "email_deliveries"("toHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "photo_objects_jobId_key" ON "photo_objects"("jobId");

-- CreateIndex
CREATE INDEX "external_fetch_log_source_createdAt_idx" ON "external_fetch_log"("source", "createdAt");

-- CreateIndex
CREATE INDEX "ocr_provider_calls_jobId_idx" ON "ocr_provider_calls"("jobId");

-- CreateIndex
CREATE INDEX "engine_jobs_reportId_idx" ON "engine_jobs"("reportId");

-- CreateIndex
CREATE INDEX "llm_calls_reportId_idx" ON "llm_calls"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "source_allowlist_kind_value_key" ON "source_allowlist"("kind", "value");

-- AddForeignKey
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_consents" ADD CONSTRAINT "parent_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_jobs" ADD CONSTRAINT "ocr_jobs_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_ambiguities" ADD CONSTRAINT "ocr_ambiguities_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ocr_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_reports" ADD CONSTRAINT "analysis_reports_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_moves" ADD CONSTRAINT "analysis_moves_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "analysis_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_recommendations" ADD CONSTRAINT "study_recommendations_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "analysis_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opponent_reports" ADD CONSTRAINT "opponent_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_events" ADD CONSTRAINT "metric_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_checkins" ADD CONSTRAINT "tournament_checkins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_objects" ADD CONSTRAINT "photo_objects_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ocr_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

