import express from "express";
import alchemyRoutes from "./alchemyMiddleware.js";

const app = express();
app.use(express.json());

// ✅ Attach middleware
app.use("/", alchemyRoutes);

// ✅ Fix: Find an available port dynamically
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Middleware running on port ${PORT}`);
}).on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.log(`❌ Port ${PORT} is already in use. Trying another port...`);
        const newPort = Math.floor(Math.random() * (5000 - 3000 + 1) + 3000);
        app.listen(newPort, () => {
            console.log(`✅ Running on new port ${newPort}`);
        });
    } else {
        console.error("❌ Server error:", err);
    }
});


