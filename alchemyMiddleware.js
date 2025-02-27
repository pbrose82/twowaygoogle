import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const ALCHEMY_REFRESH_URL = "https://core-production.alchemy.cloud/core/api/v2/refresh-token";
const ALCHEMY_UPDATE_URL = "https://core-production.alchemy.cloud/core/api/v2/update-record";
const ALCHEMY_GET_EVENT_URL = "https://core-production.alchemy.cloud/core/api/v2/get-record";
const TENANT_NAME = "productcaseelnlims4uat";
const ALCHEMY_REFRESH_TOKEN = process.env.ALCHEMY_REFRESH_TOKEN;

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
 * ✅ Check if Event Exists in Alchemy
 */
async function getAlchemyEvent(recordId, alchemyToken) {
    console.log(`🔍 Checking if event exists in Alchemy for Record ID: ${recordId}`);
    
    try {
        const response = await fetch(`${ALCHEMY_GET_EVENT_URL}/${recordId}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${alchemyToken}`,
                "Content-Type": "application/json"
            }
        });

        if (response.status === 404) {
            console.log("⚠️ Event not found in Alchemy");
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error("🔴 Error fetching event from Alchemy:", error.message);
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

    // ✅ Refresh Alchemy Token
    const alchemyToken = await refreshAlchemyToken();
    if (!alchemyToken) {
        return res.status(500).json({ error: "Failed to refresh Alchemy token" });
    }

    // ✅ Check if the event exists in Alchemy
    const existingEvent = await getAlchemyEvent(recordId, alchemyToken);

    if (req.body.deleted) {
        // ✅ Handle Event Deletion
        console.log("🚨 Event Deleted, Updating Alchemy Record");
        const deletePayload = {
            recordId,
            fields: [
                { identifier: "EventStatus", rows: [{ row: 0, values: [{ value: "Removed From Calendar" }] }] }
            ]
        };

        try {
            const response = await fetch(ALCHEMY_UPDATE_URL, {
                method: "PUT",
                headers: {
                    "Authorization": `Bearer ${alchemyToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(deletePayload)
            });

            const responseText = await response.text();
            console.log("✅ Cancellation Response from Alchemy:", responseText);
            return res.status(200).json({ success: true, message: "Event marked as removed from calendar." });
        } catch (error) {
            console.error("🔴 Error updating Alchemy record for deletion:", error.message);
            return res.status(500).json({ error: "Failed to update Alchemy", details: error.message });
        }
    }

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
        console.log("✅ Alchemy API Response:", responseText);
        res.status(200).json({ success: true, message: "Alchemy record updated", data: responseText });
    } catch (error) {
        console.error("🔴 Error updating Alchemy record:", error.message);
        res.status(500).json({ error: "Failed to update Alchemy", details: error.message });
    }
});

export default router;
