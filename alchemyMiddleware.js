import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import config from "./config.js";

const router = express.Router();

// Get Alchemy configuration from config.js
const {
  refreshUrl: ALCHEMY_REFRESH_URL,
  updateUrl: ALCHEMY_UPDATE_URL,
  tenantName: TENANT_NAME,
  refreshToken: ALCHEMY_REFRESH_TOKEN,
  fields: { startField, endField, statusField },
  eventStatuses: { pushed, cancelled }
} = config.alchemy;

/**
 * Convert Date to Alchemy Format (UTC)
 */
function convertToAlchemyFormat(dateString) {
    try {
        let date = DateTime.fromISO(dateString, { zone: "UTC" });

        if (!date.isValid) {
            throw new Error(`Invalid date format received: ${dateString}`);
        }

        return date.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
    } catch (error) {
        console.error(`Date conversion error: ${error.message}`);
        return null;
    }
}

/**
 * Refresh Alchemy API Token
 */
async function refreshAlchemyToken() {
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

        return tenantToken.accessToken;
    } catch (error) {
        console.error(`Error refreshing Alchemy token: ${error.message}`);
        return null;
    }
}

/**
 * Route to Handle Google Calendar Updates & Push to Alchemy
 */
router.put("/update-alchemy", async (req, res) => {
    if (!req.body || !req.body.recordId) {
        console.error(`Invalid request data: ${JSON.stringify(req.body)}`);
        return res.status(400).json({ error: "Invalid request data" });
    }

    const recordId = req.body.recordId;

    // Check if event is being cancelled
    if (req.body.fields && req.body.fields[0].identifier === statusField) {
        console.log(`Processing event cancellation for record ID: ${recordId}`);
        // Set the status to the configured cancellation status
        req.body.fields = [
            { identifier: statusField, rows: [{ row: 0, values: [{ value: cancelled }] }] }
        ];
    } else {
        // Convert Dates to UTC Format
        const formattedStart = convertToAlchemyFormat(req.body.start.dateTime);
        const formattedEnd = convertToAlchemyFormat(req.body.end.dateTime);

        if (!formattedStart || !formattedEnd) {
            return res.status(400).json({ error: "Invalid date format received" });
        }

        req.body.fields = [
            { identifier: startField, rows: [{ row: 0, values: [{ value: formattedStart }] }] },
            { identifier: endField, rows: [{ row: 0, values: [{ value: formattedEnd }] }] }
        ];
    }

    // Refresh Alchemy Token
    const alchemyToken = await refreshAlchemyToken();
    if (!alchemyToken) {
        return res.status(500).json({ error: "Failed to refresh Alchemy token" });
    }

    try {
        const response = await fetch(ALCHEMY_UPDATE_URL, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${alchemyToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            const responseText = await response.text();
            throw new Error(`Alchemy API Error: ${responseText}`);
        }

        const responseData = await response.text();
        res.status(200).json({ success: true, message: "Alchemy record updated", data: responseData });
    } catch (error) {
        console.error(`Error updating Alchemy record: ${error.message}`);
        res.status(500).json({ error: "Failed to update Alchemy", details: error.message });
    }
});

export default router;
