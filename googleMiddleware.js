import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

// ✅ Function to Convert Alchemy Date to ISO Format
function convertAlchemyDate(dateString, timeZone) {
    try {
        let date = DateTime.fromFormat(dateString, "MMM dd yyyy hh:mm a", { zone: "UTC" });

        if (!date.isValid) {
            throw new Error(`Invalid date format received: ${dateString}`);
        }

        return date.setZone(timeZone).toISO();
    } catch (error) {
        console.error("❌ Date conversion error:", error.message);
        return null;
    }
}

// ✅ Function to Refresh Google API Access Token
async function getGoogleAccessToken() {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
            grant_type: "refresh_token"
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Google Token Error: ${JSON.stringify(data)}`);
    }

    return data.access_token;
}

// ✅ Route to Create a Google Calendar Event
router.post("/create-event", async (req, res) => {
    console.log("📩 Alchemy request received for Google Calendar:", JSON.stringify(req.body, null, 2));

    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        return res.status(500).json({ error: "Failed to obtain Google access token" });
    }

    try {
        const timeZone = req.body.timeZone || "America/New_York";

        const eventBody = {
            calendarId: req.body.calendarId,
            summary: req.body.summary || "Default Event Name",
            location: req.body.location || "No Location Provided",
            description: req.body.description || "No Description",
            start: { dateTime: convertAlchemyDate(req.body.StartUse, timeZone), timeZone },
            end: { dateTime: convertAlchemyDate(req.body.EndUse, timeZone), timeZone },
            reminders: req.body.reminders || { useDefault: true }
        };

        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${req.body.calendarId}/events`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(eventBody)
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Google Calendar Error: ${JSON.stringify(data)}`);
        }

        console.log("✅ Event successfully created in Google Calendar:", data);
        res.status(200).json({ success: true, event: data });
    } catch (error) {
        console.error("❌ Error creating Google event:", error.message);
        res.status(500).json({ error: "Failed to create event", details: error.message });
    }
});

export default router;
