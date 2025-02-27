import express from "express";
import fetch from "node-fetch";
import { DateTime } from "luxon";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const ALCHEMY_REFRESH_URL = "https://core-production.alchemy.cloud/core/api/v2/refresh-token";
const ALCHEMY_UPDATE_URL = "https://core-production.alchemy.cloud/core/api/v2/update-record";
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

export default router;
