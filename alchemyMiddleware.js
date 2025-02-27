import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const router = express.Router();

// Alchemy API configuration
const ALCHEMY_REFRESH_URL = "https://core-production.alchemy.cloud/core/api/v2/refresh-token";
const ALCHEMY_UPDATE_URL = "https://core-production.alchemy.cloud/core/api/v2/update-record";
const TENANT_NAME = "productcaseelnlims4uat";
const ALCHEMY_REFRESH_TOKEN = process.env.ALCHEMY_REFRESH_TOKEN;

// Google Calendar API configuration
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const calendar = google.calendar('v3');

// Initialize Google Auth client
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  SCOPES
);

// Store mapping between Alchemy record IDs and Google Calendar event IDs
// In production, use a database instead of in-memory storage
const eventMappings = new Map();

/**
 * ✅ Convert Date to Alchemy Format (UTC)
 */
function convertToAlchemyFormat(dateString) {
    try {
        let date = DateTime.fromISO(dateString, { zone: "UTC" });

        if (!date.isValid) {
            throw new Error(`Invalid date format received: ${dateString}`);
        }

        return date.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
    } catch (error) {
        console.error("❌ Date conversion error:", error.message);
        return null;
    }
}

/**
 * ✅ Convert Date to Google Calendar Format
 */
function convertToGoogleFormat(alchemyDateString) {
    try {
        let date = DateTime.fromFormat(alchemyDateString, "yyyy-MM-dd'T'HH:mm:ss'Z'", { zone: "UTC" });
        
        if (!date.isValid) {
            date = DateTime.fromISO(alchemyDateString, { zone: "UTC" });
            
            if (!date.isValid) {
                throw new Error(`Invalid date format received: ${alchemyDateString}`);
            }
        }
        
        return date.toISO();
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

        if (!response.ok) {
            throw new Error(`Alchemy Token Refresh Failed: ${JSON.stringify(data)}`);
        }

        const tenantToken = data.tokens.find(token => token.tenant === TENANT_NAME);
        if (!tenantToken) {
            throw new Error(`Tenant '${TENANT_NAME}' not found in response.`);
        }

        console.log("✅ Alchemy Token Refreshed Successfully");
        return tenantToken.accessToken;
    } catch (error) {
        console.error("🔴 Error refreshing Alchemy token:", error.message);
        return null;
    }
}

/**
 * 🆕 Find existing Google Calendar event by Alchemy record ID
 */
async function findExistingGoogleEvent(recordId, calendarId = 'primary') {
    console.log(`🔍 Looking for existing Google Calendar event for Alchemy record: ${recordId}`);
    
    // Check the in-memory map first
    if (eventMappings.has(recordId)) {
        const eventId = eventMappings.get(recordId);
        console.log(`✅ Found mapped Google event ID: ${eventId}`);
        return eventId;
    }
    
    try {
        // Look for events with a custom extended property matching the Alchemy record ID
        const response = await calendar.events.list({
            auth: auth,
            calendarId: calendarId,
            privateExtendedProperty: [`alchemyRecordId=${recordId}`],
            maxResults: 1
        });
        
        if (response.data.items && response.data.items.length > 0) {
            const eventId = response.data.items[0].id;
            
            // Store in the mapping for future use
            eventMappings.set(recordId, eventId);
            
            console.log(`✅ Found Google event through API lookup: ${eventId}`);
            return eventId;
        }
        
        console.log(`⚠️ No existing Google Calendar event found for Alchemy record: ${recordId}`);
        return null;
    } catch (error) {
        console.error(`🔴 Error finding Google Calendar event: ${error.message}`);
        return null;
    }
}

/**
 * 🆕 Update or Create Google Calendar Event
 */
async function updateOrCreateGoogleEvent(recordId, eventData, calendarId = 'primary') {
    try {
        // Create the event object
        const event = {
            summary: eventData.summary || 'Alchemy Event',
            description: eventData.description || 'Event synchronized from Alchemy',
            start: {
                dateTime: eventData.start,
                timeZone: 'UTC'
            },
            end: {
                dateTime: eventData.end,
                timeZone: 'UTC'
            },
            extendedProperties: {
                private: {
                    alchemyRecordId: recordId
                }
            }
        };
        
        // Try to find an existing event
        const existingEventId = await findExistingGoogleEvent(recordId, calendarId);
        
        let response;
        
        if (existingEventId) {
            // Update existing event
            console.log(`🔄 Updating existing Google Calendar event: ${existingEventId}`);
            response = await calendar.events.update({
                auth: auth,
                calendarId: calendarId,
                eventId: existingEventId,
                resource: event
            });
            console.log(`✅ Google Calendar event updated: ${existingEventId}`);
        } else {
            // Create new event
            console.log(`➕ Creating new Google Calendar event for Alchemy record: ${recordId}`);
            response = await calendar.events.insert({
                auth: auth,
                calendarId: calendarId,
                resource: event
            });
            
            // Store the mapping
            eventMappings.set(recordId, response.data.id);
            console.log(`✅ New Google Calendar event created: ${response.data.id}`);
        }
        
        return response.data;
    } catch (error) {
        console.error(`🔴 Error updating/creating Google Calendar event: ${error.message}`);
        throw error;
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

        if (!formattedStart || !formattedEnd) {
            return res.status(400).json({ error: "Invalid date format received" });
        }

        req.body.fields = [
            { identifier: "StartUse", rows: [{ row: 0, values: [{ value: formattedStart }] }] },
            { identifier: "EndUse", rows: [{ row: 0, values: [{ value: formattedEnd }] }] }
        ];
    }

    // ✅ Refresh Alchemy Token
    const alchemyToken = await refreshAlchemyToken();
    if (!alchemyToken) {
        return res.status(500).json({ error: "Failed to refresh Alchemy token" });
    }

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

        if (!response.ok) {
            throw new Error(`Alchemy API Error: ${responseText}`);
        }

        res.status(200).json({ success: true, message: "Alchemy record updated", data: responseText });
    } catch (error) {
        console.error("🔴 Error updating Alchemy record:", error.message);
        res.status(500).json({ error: "Failed to update Alchemy", details: error.message });
    }
});

/**
 * 🆕 Route to Handle Alchemy Updates & Push to Google Calendar
 */
router.put("/update-google", async (req, res) => {
    console.log("📩 Received Alchemy Update:", JSON.stringify(req.body, null, 2));

    if (!req.body || !req.body.recordId) {
        console.error("❌ Invalid request data:", JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: "Invalid request data" });
    }

    const recordId = req.body.recordId;
    let isCancellation = false;
    let startTime, endTime, summary, description;
    
    // Extract the necessary data from the Alchemy request
    try {
        // Check if this is a status update/cancellation
        if (req.body.fields) {
            const statusField = req.body.fields.find(field => field.identifier === "EventStatus");
            if (statusField && statusField.rows && statusField.rows[0].values[0].value === "Cancelled") {
                isCancellation = true;
            }
            
            // Extract start time
            const startField = req.body.fields.find(field => field.identifier === "StartUse");
            if (startField && startField.rows && startField.rows[0].values[0].value) {
                startTime = convertToGoogleFormat(startField.rows[0].values[0].value);
            }
            
            // Extract end time
            const endField = req.body.fields.find(field => field.identifier === "EndUse");
            if (endField && endField.rows && endField.rows[0].values[0].value) {
                endTime = convertToGoogleFormat(endField.rows[0].values[0].value);
            }
            
            // You may extract other fields like summary, description if needed
            // For example:
            const titleField = req.body.fields.find(field => field.identifier === "Title");
            if (titleField && titleField.rows && titleField.rows[0].values[0].value) {
                summary = titleField.rows[0].values[0].value;
            } else {
                summary = `Alchemy Record: ${recordId}`;
            }
            
            const descField = req.body.fields.find(field => field.identifier === "Description");
            if (descField && descField.rows && descField.rows[0].values[0].value) {
                description = descField.rows[0].values[0].value;
            } else {
                description = "Event synchronized from Alchemy";
            }
        }
        
        if (!startTime || !endTime) {
            return res.status(400).json({ error: "Missing start or end time in the request" });
        }

    } catch (error) {
        console.error("❌ Error processing Alchemy data:", error.message);
        return res.status(400).json({ error: "Error processing Alchemy data", details: error.message });
    }

    try {
        if (isCancellation) {
            // Find and delete the Google Calendar event
            const existingEventId = await findExistingGoogleEvent(recordId);
            if (existingEventId) {
                await calendar.events.delete({
                    auth: auth,
                    calendarId: 'primary',
                    eventId: existingEventId
                });
                console.log(`🗑️ Google Calendar event deleted: ${existingEventId}`);
                eventMappings.delete(recordId);
            }
        } else {
            // Update or create the Google Calendar event
            const eventData = {
                summary: summary,
                description: description,
                start: startTime,
                end: endTime
            };
            
            await updateOrCreateGoogleEvent(recordId, eventData);
        }
        
        res.status(200).json({ success: true, message: "Google Calendar event updated" });
    } catch (error) {
        console.error("🔴 Error updating Google Calendar:", error.message);
        res.status(500).json({ error: "Failed to update Google Calendar", details: error.message });
    }
});

export default router;
