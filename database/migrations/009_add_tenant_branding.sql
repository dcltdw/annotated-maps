-- Migration 009: Add branding JSON column to tenants.
--
-- Stores per-tenant visual customization as a flexible JSON object.
-- Expected keys: logo_url, primary_color, accent_color, display_name, favicon_url
-- All keys are optional; the frontend falls back to platform defaults for missing values.

ALTER TABLE tenants
    ADD COLUMN branding JSON NULL DEFAULT NULL
        AFTER slug;
