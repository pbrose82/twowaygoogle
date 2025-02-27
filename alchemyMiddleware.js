import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { DateTime } from "luxon";

dotenv.config();

const router = express.Router();

const GOOGLE_CALENDAR_ID = "c_9550b7b33705605f4eb4d81ca5393a6cebf014591aed9fc9b41a75a53844ba84@group.calendar.google.com";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_ACCESS_TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const GOOGLE_CALENDAR_EVENTS_URL = `https://www.googleapis.com/calendar/v3/calendars/${GOOGLE_CALENDAR_ID}/events`;

/**
 * ✅ Function to Search for Existing Google Calendar Event
 */
async function findExistingEvent(recordId) {
    const url = `${GOOGLE_CALENDAR_EVENTS_URL}?q=RecordID:${recordId}&key=${GOOGLE_API_KEY}`;
    const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${GOOGLE_ACCESS_TOKEN}` },
    });

    const data = await response.json();
    if (!response.ok) {
        console.error("❌ Error searching Google Calendar:", JSON.stringify(data));
        return null;
    }

    const matchingEvent = data.items?.find(event => event.description?.includes(`RecordID: ${recordId}`));
    return matchingEvent || null;
}

/**
 * ✅ Route to Push Alchemy Event to Google Calendar
 */
router.post("/push-to-calendar", async (req, res) => {
    console.log("📩 Received Push to Calendar request:", JSON.stringify(req.body, null, 2));

    const { recordId, title, start, end, description, location } = req.body;
    if (!recordId || !start || !end || !title) {
        return res.status(400).json({ error: "Missing required fields in request." });
    }

    const startTime = DateTime.fromISO(start).toISO();
    const endTime = DateTime.fromISO(end).toISO();

    // ✅ Check if Event Already Exists in Google Calendar
    const existingEvent = await findExistingEvent(recordId);

    let googleCalendarResponse;
    if (existingEvent) {
        // ✅ Update Existing Event
        console.log(`🔄 Updating existing Google Calendar event: ${existingEvent.id}`);
        const updateUrl = `${GOOGLE_CALENDAR_EVENTS_URL}/${existingEvent.id}?key=${GOOGLE_API_KEY}`;
        googleCalendarResponse = await fetch(updateUrl, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${GOOGLE_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                summary: title,
                location: location || "",
                description: description || `Alchemy Reservation RecordID: ${recordId}`,
                start: { dateTime: startTime, timeZone: "UTC" },
                end: { dateTime: endTime, timeZone: "UTC" },
            }),
        });
    } else {
        // ✅ Create New Event
        console.log(`🆕 Creating new Google Calendar event for Record ID: ${recordId}`);
        googleCalendarResponse = await fetch(GOOGLE_CALENDAR_EVENTS_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${GOOGLE_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                summary: title,
                location: location || "",
                description: description || `Alchemy Reservation RecordID: ${recordId}`,
                start: { dateTime: startTime, timeZone: "UTC" },
                end: { dateTime: endTime, timeZone: "UTC" },
            }),
        });
    }

    const googleData = await googleCalendarResponse.json();
    if (!googleCalendarResponse.ok) {
        console.error("❌ Google Calendar API Error:", JSON.stringify(googleData));
        return res.status(500).json({ error: "Failed to push event to Google Calendar", details: googleData });
    }

    console.log("✅ Google Calendar Event Created/Updated:", googleData);
    res.status(200).json({ success: true, message: "Google Calendar event synced", event: googleData });
});

export default router;
