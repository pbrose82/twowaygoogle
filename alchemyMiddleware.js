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

// Ensure middleware can handle JSON properly
router.use(express.json());

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
            throw new Error(`Tenant '${TENANT_NAME}' not found.`);
        }

        console.log("✅ Alchemy Token Refreshed Successfully");
        return tenantToken.accessToken;
    } catch (error) {
        console.error("🔴 Error refreshing Alchemy token:", error.message);
        return null;
    }
}

/**
 * ✅ Handle Google Calendar Event Deletions
 */
router.post("/delete-alchemy", async (req, res) => {
    console.log("📩 Received Google Calendar Delete Event:", JSON.stringify(req.body, null, 2));

    if (!req.body || !req.body.recordId) {
        console.error("❌ Invalid deletion request data:", JSON.stringify(req.body, null, 2));
        return res.status(400).json({ error: "Invalid request data" });
    }

    const recordId = Number(req.body.recordId); // Ensure it's a number

    // ✅ Refresh Alchemy Token
    const alchemyToken = await refreshAlchemyToken();
    if (!alchemyToken) {
        return res.status(500).json({ error: "Failed to refresh Alchemy token" });
    }

    // ✅ Construct Cancellation Payload
    const cancellationPayload = {
        recordId: recordId,
        fields: [
            {
                identifier: "EventStatus",
                rows: [{ row: 0, values: [{ value: "Cancelled" }] }]
            }
        ]
    };

    console.log("📤 Sending Cancellation Request:", JSON.stringify(cancellationPayload, null, 2));

    try {
        const response = await fetch(ALCHEMY_UPDATE_URL, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${alchemyToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(cancellationPayload)
        });

        const responseText = await response.text();
        console.log("🔍 Alchemy API Response:", responseText);

        if (!response.ok) {
            throw new Error(`Alchemy API Error: ${responseText}`);
        }

        res.status(200).json({ success: true, message: "Event marked as cancelled in Alchemy", data: responseText });
    } catch (error) {
        console.error("🔴 Error updating Alchemy record:", error.message);
        res.status(500).json({ error: "Failed to update Alchemy", details: error.message });
    }
});

export default router;
