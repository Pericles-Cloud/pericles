-- Settings ownership flag: child orgs inherit their parent's settings until
-- custom settings are explicitly enabled. Default false => every existing
-- child org becomes inherited on deploy (intended).
ALTER TABLE "Organization" ADD COLUMN "custom_settings_enabled" BOOLEAN NOT NULL DEFAULT false;
