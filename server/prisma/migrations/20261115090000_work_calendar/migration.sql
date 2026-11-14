-- Which days work actually happens on.
--
-- Two new tables and nothing else. No existing column is touched, and no property
-- gets a calendar by this migration: without one, durations carry on being counted
-- in calendar days exactly as before. That is deliberate — creating a calendar
-- changes every float figure on that property's programmes, so it is a decision
-- somebody makes, not something that happens during a deploy.

CREATE TABLE "WorkCalendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Working days',
    -- Seven booleans, Monday first, as JSON. Same shape as Technician.weeklyHours.
    "workingDays" TEXT NOT NULL DEFAULT '[true,true,true,true,true,true,false]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkCalendar_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One calendar per property, plus at most one fallback with a null property.
CREATE UNIQUE INDEX "WorkCalendar_propertyId_key" ON "WorkCalendar"("propertyId");

-- A day that goes against the weekly pattern, in either direction: a holiday that
-- stops work, or a Sunday worked to claw back a slipped pour.
CREATE TABLE "CalendarException" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "working" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarException_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorkCalendar" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CalendarException_calendarId_day_key" ON "CalendarException"("calendarId", "day");
CREATE INDEX "CalendarException_calendarId_idx" ON "CalendarException"("calendarId");
