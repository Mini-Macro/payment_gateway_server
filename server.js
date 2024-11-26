const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const axios = require("axios");
const helmet = require("helmet");
require("dotenv").config();

const app = express();

// Basic security
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'",
          "https://api-preprod.phonepe.com",
          "https://mercury-t2.phonepe.com",
        ],
        frameSrc: ["'self'", "https://mercury-t2.phonepe.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://mercury-t2.phonepe.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  })
);
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables
const salt_key = process.env.PHONEPE_SALT_KEY;
const merchant_id = process.env.PHONEPE_MERCHANT_ID;
const is_production = process.env.NODE_ENV === "production";

// Base URL for PhonePe API
const phonepe_base_url = is_production
  ? "https://api.phonepe.com/apis/hermes"
  : "https://api-preprod.phonepe.com/apis/pg-sandbox";

// Health check endpoint (required by Render)
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// Add this near your other endpoints
app.get("/test", (req, res) => {
  res.json({
    message: "Server is running",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Order creation endpoint
app.post("/order", async (req, res) => {
  try {
    console.log("Received order request:", req.body);

    const { name, amount, number } = req.body;

    if (!name || !amount || !number) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const merchantTransactionId = `MT${Date.now()}${Math.random()
      .toString(36)
      .slice(2)}`;
    const callbackUrl = `${
      process.env.BASE_URL || "http://localhost:8000"
    }/status`;

    const data = {
      merchantId: merchant_id,
      merchantTransactionId: merchantTransactionId,
      name: name,
      amount: amount * 100,
      redirectUrl: callbackUrl,
      redirectMode: "POST",
      mobileNumber: number,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
      callbackUrl: callbackUrl,
    };

    console.log("Payment Request Data:", data);

    const payload = JSON.stringify(data);
    const payloadMain = Buffer.from(payload).toString("base64");
    const keyIndex = 1;
    const string = payloadMain + "/pg/v1/pay" + salt_key;
    const sha256 = crypto.createHash("sha256").update(string).digest("hex");
    const checksum = sha256 + "###" + keyIndex;

    const options = {
      method: "POST",
      url: `${phonepe_base_url}/pg/v1/pay`,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
      },
      data: {
        request: payloadMain,
      },
    };

    console.log("Sending request to PhonePe:", options.url);
    const response = await axios(options);
    console.log("PhonePe Response:", response.data);
    console.log(
      "redirectUrl:",
      response.data.data.instrumentResponse.redirectInfo.url
    );
    return res.json(response.data);
  } catch (error) {
    console.error("Error in /order:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Payment initiation failed",
      error:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : error.response?.data || error.message,
    });
  }
});

// Status check endpoint
app.post("/status", async (req, res) => {
  try {
    const merchantTransactionId = req.query.id || req.body.transactionId;
    console.log("Checking status for transaction:", merchantTransactionId);
    console.log("Status request body:", req.body);

    const keyIndex = 1;
    const string =
      `/pg/v1/status/${merchant_id}/${merchantTransactionId}` + salt_key;
    const sha256 = crypto.createHash("sha256").update(string).digest("hex");
    const checksum = sha256 + "###" + keyIndex;

    const options = {
      method: "GET",
      url: `${phonepe_base_url}/pg/v1/status/${merchant_id}/${merchantTransactionId}`,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
        "X-MERCHANT-ID": merchant_id,
      },
    };

    const response = await axios.request(options);
    console.log("Status Response:", response.data);

    const success_url =
      process.env.FRONTEND_SUCCESS_URL || "http://localhost:5173/success";
    const failure_url =
      process.env.FRONTEND_FAILURE_URL || "http://localhost:5173/failure";

    if (response.data.success === true) {
      return res.redirect(success_url);
    } else {
      return res.redirect(failure_url);
    }
  } catch (error) {
    console.error("Error in /status:", error.response?.data || error.message);
    res.redirect(
      process.env.FRONTEND_FAILURE_URL || "http://localhost:5173/failure"
    );
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
