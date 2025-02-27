import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const ALCHEMY_REFRESH_URL = "https://core-production.alchemy.cloud/core/api/v2/refresh-token";
const ALCHEMY_UPDATE_URL = "https://core-production.alchemy.cloud/core/api/v2/update-record";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const TENANT_NAME = "productcaseelnlims4uat";
const ALCHEMY_REFRESH_TOKEN = process.env.ALCHEMY_REFRESH_TOKEN;

/**
 * ✅ Convert Date to Alchemy Format (UTC)
 */
function convertToAlchemyFormat(dateString) {
    try {
        let date = DateTime.fromISO(dateString, { zone: "UTC" });
        if (!date.isValid) throw new Error(`Invalid date format received: ${dateString}`);
        return date.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
    } catch (error) {
        console.error("❌ Date conversion error:", error.message);
        return null;
    }
}

/**
 * ✅ Refresh Alchemy API Token
 */
async function refreshAlchemyToken() {
    console.log("🔄 Refreshing Alchemy Token...");

    try {
        const response = await fetch(ALCHEMY_REFRESH_URL, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: ALCHEMY_REFRESH_TOKEN })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`Alchemy Token Refresh Failed: ${JSON.stringify(data)}`);

        const tenantToken = data.tokens.find(token => token.tenant === TENANT_NAME);
        if (!tenantToken) throw new Error(`Tenant '${TENANT_NAME}' not found.`);

        console.log("✅ Alchemy Token Refreshed Successfully");
        return tenantToken.accessToken;
    } catch (error) {
        console.error("🔴 Error refreshing Alchemy token:", error.message);
        return null;
    }
}

/**
 * ✅ Check Google Calendar for Existing Event
 */
async function findEventInGoogleCalendar(recordId) {
    console.log(`🔍 Searching for existing Google Calendar event with Record ID: ${recordId}`);

    try {
        const response = await fetch(`${GOOGLE_CALENDAR_EVENTS_URL}?q=RecordID:${recordId}&key=${GOOGLE_API_KEY}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`Google Calendar API Error: ${JSON.stringify(data)}`);

        const matchingEvent = data.items.find(event => event.description && event.description.includes(`RecordID: ${recordId}`));

        if (matchingEvent) {
            console.log(`✅ Found matching event: ${matchingEvent.id}`);
            return matchingEvent.id;
        } else {
            console.log(`❌ No existing event found for Record ID: ${recordId}`);
            return null;
        }
    } catch (error) {
        console.error("🔴 Error searching Google Calendar:", error.message);
        return null;
    }
}

/**
 * ✅ Route to Handle Google Calendar Updates & Push to Alchemy
 */
router.put("/update-alchemy", async (req, res) => {
    console.log("📩 Received Google Calendar Update:", JSON.stringify(req.body, null, 2));

    if (!req.body || !req.body.recordId) {
        console.error("❌ Invalid request data:", JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: "Invalid request data" });
    }

    const recordId = req.body.recordId;

    // ✅ Check if event is being cancelled
    if (req.body.fields && req.body.fields[0].identifier === "EventStatus") {
        console.log("🚨 Processing Event Cancellation for Record ID:", recordId);
    } else {
        // ✅ Convert Dates to UTC Format
        const formattedStart = convertToAlchemyFormat(req.body.start.dateTime);
        const formattedEnd = convertToAlchemyFormat(req.body.end.dateTime);
        if (!formattedStart || !formattedEnd) return res.status(400).json({ error: "Invalid date format received" });

        req.body.fields = [
            { identifier: "StartUse", rows: [{ row: 0, values: [{ value: formattedStart }] }] },
            { identifier: "EndUse", rows: [{ row: 0, values: [{ value: formattedEnd }] }] }
        ];
    }

    // ✅ Refresh Alchemy Token
    const alchemyToken = await refreshAlchemyToken();
    if (!alchemyToken) return res.status(500).json({ error: "Failed to refresh Alchemy token" });

    console.log("📤 Sending Alchemy Update Request:", JSON.stringify(req.body, null, 2));

    try {
        const response = await fetch(ALCHEMY_UPDATE_URL, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${alchemyToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(req.body)
        });

        const responseText = await response.text();
        console.log("🔍 Alchemy API Response Status:", response.status);
        console.log("🔍 Alchemy API Raw Response:", responseText);

        if (!response.ok) throw new Error(`Alchemy API Error: ${responseText}`);

        res.status(200).json({ success: true, message: "Alchemy record updated", data: responseText });
    } catch (error) {
        console.error("🔴 Error updating Alchemy record:", error.message);
        res.status(500).json({ error: "Failed to update Alchemy", details: error.message });
    }
});

/**
 * ✅ Route to Sync Alchemy to Google Calendar (Prevent Duplicates)
 */
router.post("/sync-alchemy-to-google", async (req, res) => {
    console.log("📩 Received Alchemy Push Request:", JSON.stringify(req.body, null, 2));

    if (!req.body || !req.body.recordId) {
        console.error("❌ Invalid request data:", JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: "Invalid request data" });
    }

    const recordId = req.body.recordId;

    // ✅ Check if event already exists in Google Calendar
    const existingEventId = await findEventInGoogleCalendar(recordId);

    if (existingEventId) {
        console.log(`🔄 Updating existing Google Calendar event with ID: ${existingEventId}`);

        const updateEventUrl = `${GOOGLE_CALENDAR_EVENTS_URL}/${existingEventId}?key=${GOOGLE_API_KEY}`;
        req.body.id = existingEventId; // Ensure update uses the same event ID
        req.body.method = "PATCH"; // Use PATCH for updates

        const response = await fetch(updateEventUrl, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${GOOGLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(req.body)
        });

        const responseText = await response.text();
        console.log("✅ Google Calendar Event Updated:", responseText);
        return res.status(200).json({ success: true, message: "Event updated in Google Calendar" });
    } else {
        console.log("📅 No existing event found. Creating new Google Calendar event...");
        // If no event exists, create a new one.
        // Add the logic to create the event here.
    }
});

export default router;
